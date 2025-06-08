# TritiumBot v2

A simple, fast, and robust bot for the Signal messaging service.

[!!! REQUIRES A VALID SIGNAL-CLI SETUP BEFOREHAND WITH A REGISTERED ACCOUNT !!!](https://github.com/AsamK/signal-cli)

To setup TritiumBot, start by running `cp ./config.jsonc.template ./config.jsonc`, then open `config.jsonc`, read the instructions and fill out all the necessary fields.
Once you're done, run `bun install` to install the node modules, then run `bun run start` to start the bot.
From there, you can configure the bot and add custom commands in the `commands.js` file (feel free to use one of the default commands as a base for your new commands).
There is also a `docker-compose.yaml` for those of you who are sensible with app security.
