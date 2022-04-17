#!/usr/bin/env node
/**
 * main.js
 *
 * Content review logger.
 */

/**
 * Importing modules.
 */
import {CookieJar} from 'tough-cookie';
import {WebhookClient} from 'discord.js';
import config from './config.json' assert { type: 'json' };
import got from 'got';
import {parse} from 'node-html-parser';
import pkg from './package.json' assert { type: 'json' };
import process from 'process';
import {writeFile} from 'fs/promises';

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
        this._webhook = new WebhookClient({
            id: config.id,
            token: config.token
        });
        this._http = got.extend({
            cookieJar: new CookieJar(),
            headers: {
                'User-Agent': `${pkg.name} v${pkg.version}`
            }
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
            await this._http.post(`https://services.${config.domain}/mobile-fandom-app/fandom-auth/login`, {
                form: {
                    password: config.password,
                    username: config.username
                },
                headers: {
                    'X-Fandom-Auth': 1,
                    'X-Wikia-WikiaAppsID': 1234
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
            const html = await this._http.get(`${this._wiki}/wiki/Special:JSPages`, {
                searchParams: {
                    t: Date.now()
                }
            }).text();
            const tree = parse(html);
            const rows = tree
                .querySelectorAll('.content-review__table tbody tr');
            const pages = this.mapRows(rows);

            if (!this._data) {
                this._data = pages;
            }

            this._debug('Poll response.');
            await this._post(
                Object.values(pages)
                    .map(this._processPage, this)
                    .filter(Boolean)
            );
            await writeFile('cache.json', JSON.stringify(this._data));
        } catch (error) {
            console.error('Polling failed!', error);
        }
    }
    /**
     * Maps a row
     * @param {node-html-parser.HTMLElement[]} rows Rows of the
     *                                              content review table
     * @returns {Object<string, object>} Map of page titles to review statuses
     */
    mapRows(rows) {
        const map = {};

        for (const row of rows) {
            /*
             * Code below is pretty dense, but that's unavoidable when scraping
             * I added some newlines, if that helps
             */
            const cells = row.querySelectorAll('td');

            const title = cells[0].querySelector('a').text.trim();
            const status = Array.from(
                cells[1].querySelector('.content-review__status')
                    .classList
                    .values()
            )
                .find(cls => cls.startsWith('content-review__status--'))
                .slice('content-review__status--'.length);

            const rev = Number(cells[1].querySelector('a')
                .text
                .trim()
                .replace('#', ''));

            const liveRevisionAnchor = cells[3].querySelector('a');
            const liveRev = liveRevisionAnchor ?
                Number(liveRevisionAnchor.text.trim().replace('#', '')) :
                undefined;

            map[title] = {
                liveRev,
                rev,
                status,
                title
            };
        }

        return map;
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
        const {title, status, rev, liveRev} = page;
        const curr = this._data[title];

        let returnValue = null;
        let shouldSave = true;

        if (curr) {
            if (
                // If the new revision is older
                curr.rev > rev ||
                // or the revision stayed the same
                curr.rev === rev &&
                // but the status went back to
                (
                    // awaiting
                    (
                        curr.status === 'live' ||
                        curr.status === 'rejected'
                    ) &&
                    status === 'awaiting' ||
                    // or unsubmitted
                    curr.status !== 'unsubmitted' &&
                    status === 'unsubmitted'
                )
            ) {
                /*
                 * that means memcache somehow screwed up.
                 * - Then log it, dummy
                 */
                shouldSave = false;
            } else if (
                (curr.rev !== rev || curr.status !== status) &&
                status !== 'unsubmitted'
            ) {
                this._debug(`${title}: ${curr.rev} -> ${rev}, ${curr.status} -> ${status}`);

                returnValue = [title, rev, status, liveRev];
            }
        } else {
            this._debug('Current revision is not cached.');
        }

        // Save to cache
        if (shouldSave) {
            this._data[title] = {
                liveRev,
                rev,
                status,
                title
            };
        }

        return returnValue;
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

const instance = new ContentReviewLog();
export default instance;
instance.run();
