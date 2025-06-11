import fs from 'fs';
import subprocess from 'child_process';
import net from 'net';
import { interpretmessage } from './signalhandler.js';
import { parse } from 'jsonc-parser';

let config = parse(fs.readFileSync('config.jsonc', 'utf8'));
if (config.phonenumber === '' || config.phonenumber === null || config.phonenumber === undefined) {
    console.error('Phone number not found in config.jsonc!');
    process.exit(1);
}
if (config.socketpath === '' || config.socketpath === null || config.socketpath === undefined) {
    console.error('Socket path not found in config.jsonc!');
    process.exit(1);
};
const socketpath = config.socketpath;
const botname = config.botname || 'TritiumBot';
const botversion = config.botversion ?? true;
const tagname = config.tagname || 'Development';
const botavatar = config.botavatar;
const botabout = config.botabout || 'A simple, fast, and robust bot for Signal, powered by TritiumBot.';
const phonenumber = config.phonenumber;
const externalsignal = config.externalsignal || true;
config = undefined;
let daemon;


function startconn(client, callback) {
    if (socketpath.includes(':')) {
        const [host, port] = socketpath.split(':');
        client.connect(parseInt(port), host, callback);
    } else {
        client.connect(socketpath, callback);
    }
}

function gracefulShutdown() {
    console.log(`Shutting down ${botname}...`);
    if (daemon && !externalsignal) {
        daemon.on('exit', () => {
            process.exit(0);
        });
        daemon.kill('SIGTERM');
        setTimeout(() => {
            console.error(`Could not shut down ${botname} gracefully, forcefully shutting down...`);
            daemon.kill('SIGKILL');
            process.exit(1);
        }, 5000);
    } else {
        process.exit(0);
    }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function signalclidaemon() {
    if (!externalsignal) {
        const sf = socketpath.includes(':') ? '--tcp' : '--socket';
        const daemon = subprocess.exec(`signal-cli --config ./config daemon ${sf} ${socketpath} --receive-mode on-connection`, (err, stdout, _stderr) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(stdout);
        });
        return daemon;
    } else {
        return null;
    }
};

function signalclihook() {
    const client = new net.Socket();
    client.setMaxListeners(50);
    startconn(client, () => {
        console.log('Signal CLI hook connected');
        setupbotprofile();
    });
    client.on('data', (data) => {
        const message = data.toString();
        if (message === '' || message === null || message === undefined || message === '\n') {
            return;
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
    startconn(client, () => {
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'updateProfile',
            params: {
                account: phonenumber,
                givenName: botname,
                about: botabout,
            },
        }
        if (botversion === true && tagname) {
            json.params.familyName = `[${process.env.npm_package_version} ${tagname}]`;
        } else if (botversion === true) {
            json.params.familyName = `[${process.env.npm_package_version}]`;
        } else if (tagname) {
            json.params.familyName = `${tagname}`;
        }
        if (botavatar && fs.existsSync(botavatar)) {
            json.params.avatar = botavatar;
        }
        json = JSON.stringify(json);
        client.write(json);
        client.end();
    });
    client.on('error', (error) => {
        console.error('Error sending profile data via Signal CLI:', error);
    });
}

function main() {
    console.log(`${botname} starting...`);
    daemon = signalclidaemon();
    if (socketpath.includes(':')) {
        console.log('Method: TCP');
        const starthook = setInterval(() => {
            const testClient = new net.Socket();
            testClient.setTimeout(1000);
            
            startconn(testClient, () => {
                testClient.destroy();
                clearInterval(starthook);
                signalclihook();
            });
            
            testClient.on('error', () => {
                testClient.destroy();
            });
            
            testClient.on('timeout', () => {
                testClient.destroy();
            });
        }, 2000);
    } else {
        console.log('Method: UNIX Socket');
        const starthook = setInterval(() => {
            if (fs.existsSync(socketpath)) {
                clearInterval(starthook);
                signalclihook();
            }
        }, 100);
    }
};

main();