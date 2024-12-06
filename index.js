import fs from 'fs';
import subprocess from 'child_process';
import net from 'net';
import signalhandler from './signalhandler.cjs';
import { parse } from 'jsonc-parser';
const { interpretmessage } = signalhandler;

let config = parse(fs.readFileSync('config.jsonc', 'utf8'));
if (config.phonenumber === '' || config.phonenumber === null || config.phonenumber === undefined) {
    console.error('Phone number not found in config.jsonc!');
    process.exit(1); // skipcq: JS-0263
}
const phonenumber = config.phonenumber;
if (config.socketpath === '' || config.socketpath === null || config.socketpath === undefined) {
    console.error('Socket path not found in config.jsonc!');
    process.exit(1); // skipcq: JS-0263
};
const socketpath = config.socketpath;
const botname = config.botname;
const botversion = config.botversion;
const botavatar = config.botavatar;
const botabout = config.botabout;
config = undefined;
let daemon; // skipcq: JS-0119

function gracefulShutdown() {
    console.log('Shutting down TritiumBot...');
    if (daemon) {
        daemon.on('exit', () => {
            process.exit(0); // skipcq: JS-0263
        });
        daemon.kill('SIGTERM');
        setTimeout(() => {
            console.error('Could not shut down TritiumBot gracefully, forcefully shutting down...');
            process.exit(1); // skipcq: JS-0263
        }, 5000);
    } else {
        process.exit(0); // skipcq: JS-0263
    }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function signalclidaemon() {
    const daemon = subprocess.exec(`signal-cli daemon --socket ${socketpath} --receive-mode on-connection`, (err, stdout, _stderr) => { // skipcq: JS-0123
        if (err) {
            console.error(err);
            return;
        }
        console.log(stdout);
    });
    return daemon;
};

function signalclihook() {
    const client = new net.Socket();
    client.connect(socketpath, () => {
        console.log('Signal CLI hook connected');
        setupbotprofile();
    });
    client.on('data', (data) => {
        const message = data.toString();
        if (message === '' || message === null || message === undefined || message === '\n') {
            return; // skipcq: JS-W1045
        } else {
            interpretmessage(message);
        }
    });
    client.on('close', () => {
        console.log('Signal CLI hook disconnected');
    });
    client.on('error', (error) => {
        console.error('Error hooking to Signal CLI:', error);
    });
};

function setupbotprofile() {
    const client = new net.Socket();
    client.connect(socketpath, () => {
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'updateProfile',
            params: {
                givenName: botname,
                avatar: botavatar,
                about: botabout,
            },
        }
        if (botversion === true) {
            const botversionjson = parse(fs.readFileSync('package.json', 'utf8')).version;
            json.params.familyName = `[${botversionjson} Alpha]`;
        }
        json = JSON.stringify(json);
        client.write(json);
        client.end();
        /*client.on('data', (data) => {
            const content = data.toString();
            if (content == null || content === '' || content === undefined || content === '\n') {
                return;
            } else {
                try {
                    const parsedJson = JSON.parse(content);
                    if (parsedJson.id === id) {
                        if (parsedJson.error) {
                            console.error('Error sending profile data:', parsedJson.error, parsedJson.error.data.response.results);
                            return;
                        }
                        const result = parsedJson.result;
                        const results = result.results;
                        if (results === undefined) {
                            client.end();
                            return;
                        }
                    } else {
                        client.end();
                        return;
                    }
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                }
            };
        });
        setTimeout(() => {
            if (!client.destroyed) {
                client.end();
            }
        }, 5000);*/
    });
    client.on('error', (error) => {
        console.error('Error sending profile data via Signal CLI:', error);
    });
}

function main() {
    console.log('TritiumBot starting...');
    daemon = signalclidaemon();
    const starthook = setInterval(() => {
        if (fs.existsSync(socketpath)) {
            clearInterval(starthook);
            signalclihook();
        }
    }, 100);
};

main();