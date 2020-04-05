# ContentReviewLog
Discord webhook relay of changes to review status of Fandom scripts, mostly intended for use on [Dev Wiki's Discord server](https://dev.fandom.com/wiki/Project:Discord). Based on polling.
![Demonstration.](https://uploads.kocka.tech/ContentReviewLog-screenshot.png)

## Installation
To install required packages, run:
```console
$ npm install
```

## Configuration
To run the configuration wizard for ContentReviewLog, run:
```console
$ npm run-script config
```
Alternatively, create a JSON file with the following contents:
```json
{
    "username": "Fandom username",
    "password": "Fandom password",
    "interval": 20000,
    "id": "1234",
    "token": "abcd",
    "wiki": "dev",
    "domain": "wikia.com"
}
```
Where the keys mean:
- `username`: Fandom username of a user that's supposed to log in.
- `password`: Password for the Fandom user that is supposed to log in,
- `interval`: Amount of miliseconds between checks.
- `id`: Discord webhook ID.
- `token`: Discord webhook token.
- `wiki`: Fandom wiki domain.
- `domain`: Can be either `wikia.com`, `fandom.com` or `wikia.org`.
- `lang`: Language in the article path.
- `debug`: Whether more output should be logged.

## Running
To run ContentReviewLog after having it configured, use:
```console
$ npm start
```

## Updating
To update ContentReviewLog to latest version, use:
```console
$ npm run-script update
```
