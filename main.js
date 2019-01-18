/**
 * main.js
 *
 * Content review logger.
 */
'use strict';

/**
 * Importing modules.
 */
const http = require('request-promise-native'),
      fs = require('fs'),
      config = require('./config.json');

/**
 * Constants.
 */
const USER_AGENT = 'ContentReviewLog v1.1.0',
      DATA = {
          awaiting: ['Revision awaiting review', 0x008CCE],
          live: ['Revision approved', 0x76BF06],
          rejected: ['Revision rejected', 0xE1390B]
      };

/**
 * Main class for the content review logger.
 */
class ContentReviewLog {
    /**
     * Class constructor.
     * Logs in to Fandom.
     */
    constructor() {
        this._jar = http.jar();
        this._debug('Logging in...');
        http({
            form: {
                password: config.password,
                username: config.username
            },
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            jar: this._jar,
            method: 'POST',
            uri: 'https://services.wikia.com/auth/token'
        }).then(this._init.bind(this))
        .catch(this._loginFail.bind(this));
    }
    /**
     * Logs content while in debug mode.
     * @param {String} content Message to log
     * @private
     */
    _debug(content) {
        if (config.debug) {
            console.debug(content);
        }
    }
    /**
     * Initializes the logger interval and reconstructs the wiki URL.
     * @private
     */
    _init() {
        this._debug('Logged in.');
        if (config.wiki.includes('.')) {
            this._wiki = `http://${config.wiki}.${config.domain}`;
        } else if (config.lang) {
            this._wiki = `https://${config.wiki}.${config.domain}/${config.lang}`;
        } else {
            this._wiki = `https://${config.wiki}.${config.domain}`;
        }
        try {
            this._data = require('./cache.json');
        } catch (e) {
            console.info(
                'No cache.json file found, data will be created from scratch.'
            );
        }
        this._interval = setInterval(
            this._poll.bind(this),
            config.interval
        );
        this._poll();
    }
    /**
     * Callback after a failed login.
     * @param {Error} error Error that occurred while logging in
     * @private
     */
    _loginFail(error) {
        console.error('Failed to log in!', error);
    }
    /**
     * Polls Nirvana for status of JavaScript pages.
     * @private
     */
    _poll() {
        this._debug('Polling...');
        http({
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            jar: this._jar,
            json: true,
            method: 'GET',
            qs: {
                controller: 'JSPagesSpecial',
                format: 'json',
                t: Date.now()
            },
            uri: `${this._wiki}/wikia.php`
        }).then(this._callback.bind(this))
        .catch(this._pollFail.bind(this));
    }
    /**
     * Callback after fetching JavaScript status.
     * @param {Object} data Fetched JavaScript review data
     * @private
     */
    _callback(data) {
        this._debug('Poll response.');
        let pages = {};
        if (data && data.jsPages) {
            pages = data.jsPages;
        }
        if (!this._data) {
            this._data = pages;
        }
        const embeds = [];
        for (const i in pages) {
            const page = pages[i],
                  title = page.page_title,
                  rev = page.latestRevision.revisionId,
                  status = page.latestRevision.statusKey,
                  curr = this._data[title];
            if (curr && curr.rev > rev) {
                // memcache screwed up
                return;
            }
            this._debug(`${curr.rev} -> ${rev}, ${curr.status} -> ${status}`);
            if (
                (curr.rev !== rev || curr.status !== status) &&
                status !== 'unsubmitted'
            ) {
                embeds.push([title, rev, status]);
            }
            this._data[title] = {
                rev,
                status
            };
        }
        this._post(embeds);
        fs.writeFile(
            'cache.json',
            JSON.stringify(this._data),
            this._fileCallback.bind(this)
        );
    }
    /**
     * Callback after a failed poll.
     * @param {Error} error Poll error
     * @private
     */
    _pollFail(error) {
        console.error('Polling failed!', error);
    }
    /**
     * Posts a log to Discord.
     * @param {Array<Object>} embeds Embed data
     * @private
     */
    _post(embeds) {
        http({
            body: JSON.stringify({
                embeds: embeds.map(function([title, rev, status]) {
                    const encTitle = encodeURIComponent(title);
                    let desc = `[${title}](${this._wiki}/wiki/MediaWiki:${encTitle}) | [Diff](${this._wiki}/?diff=${rev})`;
                    if (status === 'rejected') {
                        desc += ` | [Talk page](${this._wiki}/wiki/MediaWiki_talk:${encTitle})`;
                    }
                    return {
                        color: DATA[status][1],
                        description: desc,
                        timestamp: new Date(),
                        title: DATA[status][0],
                        url: `${this._wiki}/?oldid=${rev}`
                    };
                }, this)
            }),
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            method: 'POST',
            uri: `https://discordapp.com/api/webhooks/${config.id}/${config.token}`
        }).catch(this._discordError.bind(this));
    }
    /**
     * Handles errors while posting to Discord.
     * @param {Error} error Error that occurred
     * @private
     */
    _discordError(error) {
        console.error('Error while posting to Discord!', error);
    }
    /**
     * Callback after saving cache.
     * @param {Error} error File save error
     * @private
     */
    _fileCallback(error) {
        if (error) {
            console.error('Error while saving cache!', error);
        }
    }
}

module.exports = new ContentReviewLog();
