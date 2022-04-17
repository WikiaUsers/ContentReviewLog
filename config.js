/**
 * config.js
 *
 * Utility module for configuring ContentReviewLog.
 */
'use strict';

/**
 * Importing modules.
 */
import fs from 'fs';
import readline from 'readline';

/**
 * Constants.
 */
const QUESTIONS = [
    ['username', 'Fandom username'],
    ['password', 'Fandom password'],
    ['interval', 'Update interval (in seconds)'],
    ['url', 'Webhook URL'],
    ['wiki', 'Fandom wiki URL']
], WIKI_REGEX = /^(?:https?:\/\/)?([a-z0-9-.]+)\.(wikia\.(?:com|org)|fandom\.com)(?:\/([a-z-]+))?\/?$/,
WEBHOOK_REGEX = /^https?:\/\/(?:canary\.|ptb\.)?discordapp\.com\/api\/webhooks\/(\d+)\/([a-zA-Z0-9-_]+)$/;

/**
 * Class used for configuration of ContentReviewLog.
 */
class Configuration {
    /**
     * Class constructor.
     * @constructor
     */
    constructor() {
        this._rl = readline.createInterface({
            historySize: 0,
            input: process.stdin,
            output: process.stderr
        });
        this._next();
    }
    /**
     * Asks the next question.
     * @private
     */
    _next() {
        this._question = QUESTIONS.shift();
        this._rl.question(`${this._question[1]}: `, this._callback.bind(this));
    }
    /**
     * Callback after answering the question.
     * @param {String} answer Answer to the question
     * @private
     */
    _callback(answer) {
        this[`_${this._question[0]}`] = answer;
        if (QUESTIONS.length) {
            this._next();
        } else {
            this._finish();
        }
    }
    /**
     * After collecting question results.
     * @private
     */
    _finish() {
        const config = {
            interval: Number(this._interval) * 1000,
            password: this._password,
            username: this._username
        };
        const res = WEBHOOK_REGEX.exec(this._url),
              res2 = WIKI_REGEX.exec(this._wiki);
        if (isNaN(config.interval)) {
            console.error('Invalid interval!');
            return;
        }
        if (res) {
            config.id = res[1];
            config.token = res[2];
        } else {
            console.error('Webhook URL invalid!');
            return;
        }
        if (res2) {
            config.wiki = res2[1];
            config.domain = res2[2];
            config.lang = res2[3];
        } else {
            console.error('Wiki URL invalid!');
            return;
        }
        fs.writeFile(
            'config.json',
            JSON.stringify(config, null, '    '),
            this._write.bind(this)
        );
    }
    /**
     * After writing configuration to file.
     * @param {Error} error Error that occurred
     * @private
     */
    _write(error) {
        if (error) {
            console.error('An error occurred while writing to file:', error);
        } else {
            console.log('Configuration successful, run `npm start`.');
            process.exit();
        }
    }
}

const instance = new Configuration();
export default instance;
