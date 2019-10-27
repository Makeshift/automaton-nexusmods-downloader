const log = require('connor-base-log');
const config = require('connor-base-config').addToSchema(require("./envspec.json5"), true);
const http = require('https');
const puppeteer = require('puppeteer');
const unzip = require('unzip-stream');
const path = require('path');
const fs = require('fs').promises;
const fsnp = require('fs');
const stream = require('stream');
const md5 = require('md5-file/promise');
const _cliProgress = require('cli-progress');
const _colors = require('colors');

function extractAutoFile() {
    return new Promise(resolve => {
        let file = path.normalize(config.get("autofile"));
        let folders = [];
        let gotFolders = false;
        let mods = [];
        fsnp.createReadStream(file)
            .pipe(unzip.Parse())
            .pipe(stream.Transform({
                objectMode: true,
                transform: async (entry, a, cb) => {
                    if (entry.path === "modpack.json") {
                        folders = (await parseJsonFile(entry)).mod_install_folders;
                        gotFolders = true;
                    } else if (gotFolders) {
                        folders.map(async folder => {
                            if (entry.path.startsWith(folder) && entry.type === "File") {
                                log.verbose(`Processing ${entry.path}`);
                                mods.push(parseJsonFile(entry))
                            }
                        });
                    }
                    cb()
                }
            }))
            .on('finish', async () => {
                mods = await Promise.all(mods);
                resolve(mods)
            })
    })
}

function parseJsonFile(file) {
    return new Promise(resolve => {
        let rawPayload = "";
        file.pipe(stream.Transform({
            transform: (payload, error, cb) => {
                rawPayload += payload;
                cb();
            }
        })).on('finish', () => {
            log.debug(rawPayload);
            resolve(JSON.parse(rawPayload.toString()))
        })
    })
}

async function initBrowser(cookies) {
    const browser = await puppeteer.launch({headless: true, defaultViewport: {width: 1024, height: 768}});
    const page = await browser.newPage();
    await page._client.send('Page.setDownloadBehavior', {behavior: 'deny'});
    await page.goto('https://www.nexusmods.com/', {waitUntil: 'networkidle2'});
    await page.setCookie(...cookies);
    return [browser, page];
}

async function downloadFile(link, filename, multibar, totalBar, totalDownloaded) {
    let downloadPath = path.resolve(__dirname, config.get("downloaddir"), filename);
    let file = fsnp.createWriteStream(downloadPath);
    let singleBar;
    log.verbose("Downloading file", {path: downloadPath, file: link});
    await new Promise(resolve => {
        http.get(link).on('response', res => {
            let length = Number(res.headers['content-length']);
            singleBar = multibar.create((Number(length) / 1024 / 1024).toFixed(2), 0);
            let downloaded = 0;
            res.on('data', chunk => {
                file.write(chunk);
                downloaded += chunk.length;
                totalBar.update((Number(totalDownloaded) + (downloaded / 1024 / 1024)).toFixed(2), {filename: "Total"});
                singleBar.update((downloaded / 1024 / 1024).toFixed(2), {filename: filename});
            }).on('end', () => resolve())
        })
    });
    file.close();
    if (singleBar) multibar.remove(singleBar);
    log.verbose("File download complete", {path: downloadPath});
    return downloadPath;
}

function pathExists(file) {
    return new Promise(resolve => {
        fs.access(file)
            .then(() => resolve(true))
            .catch(() => resolve(false))
    })
}

async function checkDownloads(downloads) {
    let topLevelDownloadPath = path.resolve(__dirname, config.get("downloaddir"));
    log.verbose("Check if download directory exists", {downloadDir: topLevelDownloadPath});
    //Remove files that aren't on Nexus
    downloads = downloads.filter(a => a.nexus_mod_id);
    if (!await pathExists(topLevelDownloadPath)) {
        log.verbose("Download dir does not exist, not bothering to check files");
        return downloads;
    }
    log.verbose("Check if files exist");
    let newDownloads = [];
    await Promise.all(downloads.map(async download => {
        let file = path.resolve(topLevelDownloadPath, download.file_name);
        let fileExists = await pathExists(file);
        let fileValid = fileExists ? await fileIsValid(file, download.md5) : null;
        if (fileExists && fileValid) {
            log.debug("File is valid, continuing", {file: file});
        } else if (!fileExists) {
            log.debug("File does not exist, adding to queue", {file: file});
            newDownloads.push(download);
        } else if (!fileValid) {
            log.verbose("File is invalid, adding to queue", {file: file});
            newDownloads.unshift(download);
        }
    }));
    return newDownloads;
}

async function fileIsValid(path, expectedHash) {
    let actualHash = await md5(path);
    if (actualHash !== expectedHash) {
        log.warn("Incorrect hash!", {path: path, expectedHash: expectedHash, actualHash: actualHash});
        return false
    }
    return true;
}

async function downloadMods(downloads, cookies) {
    let topLevelDownloadPath = path.resolve(__dirname, config.get("downloaddir"));
    await fs.mkdir(topLevelDownloadPath, {recursive: true});
    let [browser, page] = await initBrowser(cookies);
    let totalDownloadsSize = downloads.map(a => Number(a.file_size)).reduce((a, c) => a + c);
    const multibar = new _cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true

    }, {
        format: `   ${_colors.cyan('{bar}')} | {percentage}% || {value} MB / {total} MB || {eta_formatted} || {filename} `,
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });
    const totalBar = multibar.create((totalDownloadsSize / 1024 / 1024).toFixed(2), 0);
    let totalDownloaded = 0;
    let failedDownloads = [];
    for (let download of downloads) {
        try {
            let downloadPage = `https://www.nexusmods.com/Core/Libs/Common/Widgets/DownloadPopUp?id=${download.nexus_file_id}&game_id=110&source=FileExpander`;
            log.verbose("Navigating to download page", {page: downloadPage});
            await page.goto(downloadPage, {waitUntil: 'load'});
            log.verbose("Waiting for download link to be available");
            await page.waitForFunction(`!!document.getElementById("dl_link")`);
            log.verbose("Got download link element");
            let downloadLink = await page.$eval("#dl_link", e => e.value);
            log.verbose("Download link", {link: downloadLink});
            let downloadPath = await downloadFile(downloadLink, download.file_name, multibar, totalBar, totalDownloaded);
            let fileValid = await fileIsValid(downloadPath, download.md5);
            if (!fileValid && !download.isRetry) {
                download.isRetry = true;
                downloads.push(download);
            } else if (!fileValid && download.isRetry) {
                log.error("This file has failed download twice. Maybe it's broken?", {file: download.file_name})
            } else {
                log.verbose("File downloaded", {file: download.name});
                totalDownloaded += Number(download.file_size) / 1024 / 1024;
                totalBar.update(totalDownloaded.toFixed(2), {filename: "Total"})
            }
        } catch (e) {
            if (!download.isRetry) {
                log.error("Download error has occurred, adding to retry list", {error: e});
                download.isRetry = true;
                downloads.push(download);
            } else {
                log.error("This file has failed download twice. Maybe it's broken?", {file: download.file_name});
                failedDownloads.push(download);
            }
        }
    }
    browser.close();
    return failedDownloads;
}

async function login() {
    const browser = await puppeteer.launch({headless: false, defaultViewport: {width: 1024, height: 768}});
    const page = await browser.newPage();
    await page.goto('https://www.nexusmods.com/', {waitUntil: 'networkidle2'});
    await page.tap("#login");
    await page.waitForSelector("#form-username");
    await page.type("#form-username", config.get("nexus_user"));
    await page.type("#form-password", config.get("nexus_pass"));
    await page.waitForSelector("#sign-in-button", {visible: true});
    await page.tap("#sign-in-button");
    await page.waitForNavigation({waitUntil: ["networkidle2", "load"], timeout: 1000 * 120});
    let cookies = await page.cookies();
    log.info("Copy these cookies and put them in an environment variable if you're going to need to start this script more than once");
    console.log(JSON.stringify(cookies))
    browser.close();
    return cookies;
}

async function go() {
    let downloads = await extractAutoFile();
    downloads = await checkDownloads(downloads);
    let cookies = config.get("cookie") ? JSON.parse(config.get("cookie")) : await login();
    let failedDownloads = await downloadMods(downloads, cookies);
    if (failedDownloads.length > 0) {
        let cleanFailedDownloads = failedDownloads.map(d => {
            delete d.installation_parameters;
            return d;
        });
        log.error("The following mods failed to download and should be investigated manually.", {mods: cleanFailedDownloads});
        process.exit(1);
    }
    log.info("All done!");
    process.exit(0)
}

go();