# Automaton Nexusmods Downloader

This script takes an [Automaton](https://github.com/metherul/Automaton) `.auto` file, designed for Skyrim modpacks, and downloads all of the required files.

Technically Automoton already supports this, but it makes use of the NexusMods downloader, which requires a premium NexusMods account. I don't have a premium NexusMods account, and I'm not going to manually download 300 mods one at a time.

When you aren't a premium NexusMods member, you are limited to 1MB/s and a single download at a time. This tool will queue them all up and download them for you using your credentials.

## Installation

```bash
git clone https://github.com/makeshift/automaton-nexusmods-downloader
cd automaton-nexusmods-downloader
npm install
```

## Usage
You will need to supply at minimum a NexusMods username & password, as well as a `.auto` file.

| Option      	| Description                                                                                	| Eg.                                                                     	| Default                                        	|
|-------------	|--------------------------------------------------------------------------------------------	|-------------------------------------------------------------------------	|------------------------------------------------	|
| nexus_user  	| Your nexus username                                                                        	| Makeshift                                                               	|                                                	|
| nexus_pass  	| Your nexus password                                                                        	| Asupersecretpassword                                                    	|                                                	|
| autofile    	| An [Automaton](https://github.com/metherul/Automaton) `.auto` file, relative to `index.js` 	| ./US 4.0.6 hf 1 (Keyboard) - LD Hotfix 1.auto                           	| ./ US 4.0.6 hf 1 (Keyboard) - LD Hotfix 1.auto 	|
| downloaddir 	| Download directory relative to `index.js`                                                  	| ./downloads/                                                            	| ./downloads/                                   	|
| cookie      	| An array of cookies used to skip login                                                     	| `[{"name":"sid","value": "secret","domain":".nexusmods.com"...},{...}]` 	|                                                	|
| log_level   	| One of `error`, `warn`, `info`, `verbose` or `debug`.                                      	| verbose                                                                 	| info                                           	|

All above can be passed in as either an environment variable or an argument to the application, eg.

```
# Windows
set nexus_user=makeshift
node --nexus_pass password index.js

# Linux
nexus_user=makeshift
nexus_pass=password
node --autofile ./file.auto index.js
```

### Skipping login
You can skip the login step on subsequent runs by adding a `cookie` env var/arg. The cookie variable is outputted in plaintext for you after a successful login.

## Contributing
Pull requests are welcome. This could easily be adapted to be a download manager for Nexus Mods and support other types of lists. I'd also like to get rid of the dependency on Pupeteer since it's huge, but it seemed like the easiest option at the time.

Also, I really should save the cookie to a file, but eh.