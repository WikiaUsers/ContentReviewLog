/**
 * main.js
 *
 * Content review logger.
 */
'use strict';

/**
 * Importing modules.
 */
const fs = require('fs').promises,
      process = require('process'),
      {WebhookClient} = require('discord.js'),
      got = require('got'),
      {CookieJar} = require('tough-cookie'),
      config = require('./config.json'),
      pkg = require('./package.json');

/**
 * Constants.
 */
const DATA = {
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
     */
    constructor() {
        this._initHTTP();
        this._initCache();
        this._wiki = this._getWikiUrl(config.wiki, config.domain, config.lang);
        process.on('SIGINT', this._finish.bind(this));
    }
    /**
     * Initializes the HTTP and Discord clients used for communication with
     * Fandom and Discord.
     * @private
     */
    _initHTTP() {
        this._webhook = new WebhookClient(config.id, config.token);
        this._http = got.extend({
            cookieJar: new CookieJar(),
            headers: {
                'User-Agent': `${pkg.name} v${pkg.version}`
            },
            resolveBodyOnly: true,
            responseType: 'json'
        });
    }
    /**
     * Initializes the cache for saving last review state.
     * @private
     */
    _initCache() {
        try {
            this._data = require('./cache.json');
        } catch (error) {
            console.info(
                'No cache.json file found, data will be created from scratch.'
            );
        }
    }
    /**
     * Converts a triplet of (subdomain, domain, language) into a Fandom
     * wiki URL.
     * @param {string} wiki Subdomain of the wii
     * @param {string} domain Domain of the wiki (fandom.com/wikia.org)
     * @param {string} language Language in the wiki's article path
     * @returns {string} URL of the wiki
     */
    _getWikiUrl(wiki, domain, language) {
        if (wiki.includes('.')) {
            const [subdomain, lang] = wiki.split('.');
            return `https://${subdomain}.${domain}/${lang}`;
        } else if (language) {
            return `https://${wiki}.${domain}/${language}`;
        }
        return `https://${wiki}.${domain}`;
    }
    /**
     * Logs into Fandom and initiates the polling.
     */
    async run() {
        this._debug('Logging in...');
        try {
            await this._http.post(`https://services.${config.domain}/auth/token`, {
                form: {
                    password: config.password,
                    username: config.username
                }
            });
            this._debug('Logged in.');
            this._interval = setInterval(
                this._poll.bind(this),
                config.interval
            );
            await this._poll();
        } catch (error) {
            console.error('Failed to log in!', error);
        }
    }
    /**
     * Logs content while in debug mode.
     * @param {string} content Message to log
     * @private
     */
    _debug(content) {
        if (config.debug) {
            console.debug(content);
        }
    }
    /**
     * Polls Nirvana for status of JavaScript pages.
     * @private
     */
    async _poll() {
        this._debug('Polling...');
        try {
            const data = await this._http.get(`${this._wiki}/wikia.php`, {
                searchParams: {
                    controller: 'JSPagesSpecial',
                    format: 'json',
                    t: Date.now()
                }
            });
            this._debug('Poll response.');
            let pages = {};
            if (data && data.jsPages) {
                pages = data.jsPages;
            }
            if (!this._data) {
                this._data = pages;
            }
            await this._post(
                Object.values(pages)
                    .map(this._processPage, this)
                    .filter(Boolean)
            );
            await fs.writeFile('cache.json', JSON.stringify(this._data));
        } catch (error) {
            console.error('Polling failed!', error.error);
        }
    }
    /**
     * Processes received page information.
     * If a page's revision status changed it returns the values required for
     * Discord embeds.
     * Also updates the currently cached information about the page.
     * @param {Object} page JavaScript page information
     * @returns {Array|undefined} Array of {title, revision, status, (optional)
     *                            live revision} to be passed on to the Discord
     *                            embed formatter.
     */
    _processPage(page) {
        const title = page.page_title,
              rev = page.latestRevision.revisionId,
              status = page.latestRevision.statusKey,
              liveRev = page.liveRevision.revisionId,
              curr = this._data[title];
        if (curr) {
            if (curr.rev > rev) {
                // memcache screwed up
                return;
            }
            if (
                (curr.rev !== rev || curr.status !== status) &&
                status !== 'unsubmitted'
            ) {
                this._debug(`${title}: ${curr.rev} -> ${rev}, ${curr.status} -> ${status}`);
                // TODO: DRY
                this._data[title] = {
                    rev,
                    status
                };
                return [title, rev, status, liveRev];
            }
        }
        this._data[title] = {
            rev,
            status
        };
    }
    /**
     * Formats and posts the review status change to Discord.
     * @param {Array<Array>} embeds Embed data
     * @private
     */
    async _post(embeds) {
        if (embeds.length === 0) {
            return;
        }
        try {
            await this._webhook.send({
                embeds: embeds.map(function([title, rev, status, liveRev]) {
                    const encTitle = encodeURIComponent(title);
                    let desc = `[${title}](${this._wiki}/wiki/MediaWiki:${encTitle}) | `;
                    if (rev !== liveRev && liveRev !== undefined) {
                        desc += `[Diff](${this._wiki}/?oldid=${liveRev}&diff=${rev})`;
                    } else {
                        desc += `[Permalink](${this._wiki}/?oldid=${rev})`;
                    }
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
            });
        } catch (error) {
            console.error('Error while posting to Discord:', error);
        }
    }
    /**
     * Cleans up the polling interval and webhook client.
     * @private
     */
    _finish() {
        console.info('Exiting...');
        clearInterval(this._interval);
        this._webhook.destroy();
    }
}

module.exports = new ContentReviewLog();
module.exports.run();
