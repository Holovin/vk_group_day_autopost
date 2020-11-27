import { Config, Logger, LoggerType } from 'lib-dd-helpers';
import { VkLib } from './vk-lib';
import got, { Got } from 'got';
import * as cheerio from 'cheerio';
import cheerioModule from 'cheerio';
import * as cookie from 'tough-cookie';
import * as iconv from 'iconv-lite';
import sample from 'lodash/sample';
import random from 'lodash/random';
import { authenticator } from 'otplib';
import puppeteer from 'puppeteer';

class App {
    private got: Got;
    private config: Config;
    private vkLib: VkLib;
    private log: LoggerType;
    private cheerio: cheerio.CheerioAPI;
    private readonly jar: cookie.CookieJar;
    private browser: puppeteer.Browser;
    private page: puppeteer.Page;

    private readonly groupId: number;
    private readonly userId: string;

    constructor() {
        this.log = Logger.getInstance().getLogger('app');
        this.config = Config.getInstance();

        this.cheerio = cheerioModule;
        this.jar = new cookie.CookieJar();
        this.got = got.extend({
            headers: {
                'Accept-Language': 'ru',
                'Connection': 'keep-alive',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0'
            },
            cookieJar: this.jar,
        });

        this.vkLib = new VkLib(this.got, {
            token: this.config.get('token'),
            loginUrl: this.config.get('url'),
        });

        this.groupId = this.config.get('group_id');
        this.userId = this.config.get('user_id');
    }

    public async getAuthCookie() {
        const cookies = await this.page.cookies();
        const authCookie = cookies.find(item => item.name === 'remixsid');
        if (!authCookie) {
            this.log.warn(`No auth cookie`);
            return;
        }

        this.log.info(`Cookie value ${authCookie.value}`);
        return authCookie.value;
    }

    public async refreshBrowser() {
        const pos = random(1, 8);

        await this.page.click(`#side_bar_inner li:nth-child(${pos})`);
        await this.page.waitForNavigation();

        const cookie = await this.getAuthCookie();
        if (cookie) {
            this.log.info('Refresh ok, cookies ok');
            return true;
        }

        const client = await this.page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        this.log.info('Refresh failed, clear cookies');
        return false;
    }

    public async login() {
        await this.page.goto('https://vk.com', { waitUntil: 'domcontentloaded' });

        await this.page.waitForSelector('#index_email');

        await this.page.focus('#index_email');
        await this.page.type('#index_email', this.config.get('login'), { delay: 50 });

        await this.page.focus('#index_pass');
        await this.page.type('#index_pass', this.config.get('password'));

        await this.page.click('#index_login_button');

        await this.page.waitForNavigation();
        await this.page.waitForTimeout(1000);

        const otp = authenticator.generate(this.config.get('secret'));
        await this.page.focus('#authcheck_code');
        await this.page.type('#authcheck_code', otp);

        await this.page.click('#login_authcheck_submit_btn');

        await this.page.waitForNavigation();
        await this.page.waitForTimeout(1000);

        this.log.info('Login done');
    }

    public async initBrowser() {
        if (this.browser) {
            this.log.warn('Browser already initialized');
            return false;
        }

        this.browser = await puppeteer.launch({ headless: true });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1920, height: 1080 });

        this.log.info('Init browser ok');
        return true;
    }

    public async wallCheck() {
        const lastPost = await this.vkLib.apiVkCall('wall.get', {
            owner_id: -this.groupId,
            count: 1,
            extended: 0,
        });

        if (!lastPost?.response?.items[0]?.date) {
            this.log.warn(`Empty wall items`);
            return null;
        }

        const now = Math.floor(+Date.now() / 1000);
        const lastPostTime = +lastPost.response.items[0].date;
        const DAY = 86400;

        this.log.debug(`Diff: ${now - lastPostTime} > 86400`);

        return (now - lastPostTime) > DAY;
    }

    public async getBTPlace() {
        let response = await this.got.get(this.userId);

        if (!response.body) {
            this.log.warn(`No body at BT response`);
            return null;
        }

        const body = iconv.decode(response.rawBody, 'cp1251');
        const page = this.cheerio.load(body, { xmlMode: true });
        const result = page('.BugtrackerReporterProfile__content').text().trim().match(/#(\d+)\s/)?.[1];

        if (result) {
            return +result;
        }

        this.log.warn(`BT parse failed`);
        return null;
    }

    public async wallPost(text) {
        this.log.info(`Post message ${text}`);

        return this.vkLib.apiVkCall('wall.post', {
            owner_id: -this.groupId,
            friends_only: 0,
            from_group: 1,
            message: text,
        });
    }

    public async syncCookiesFromWeb() {
        const value = await this.getAuthCookie();

        if (!value) {
            this.log.warn(`Sync cookie failed`);
            return false;
        }

        this.jar.setCookieSync(
            new cookie.Cookie({ key: 'remixsid', value: value }),
            'https://vk.com/',
            { secure: true, http: true, }
        );

        this.log.info(`Sync cookie ok`);
        return true;
    }

    public async checkToken() {
        return await this.vkLib.getMe();
    }
}

(async () => {
    const needPlace = 10;
    const lastDate  = 1621026000;  // 15/05/2021, 00:00:00
    const startDate = 1605906000;  // 21/11/2020, 00:00:00

    const log = Logger.getInstance().getLogger('main');
    const app = new App();

    if (!await app.checkToken()) {
        log.error('Error at token check');
        process.exit(1);
    }

    if (!await app.initBrowser()) {
        log.error('Error at init browser');
        process.exit(1);
    }

    await app.login();
    if (!await app.syncCookiesFromWeb()) {
        log.error('Error cookies sync');
        process.exit(1);
    }

    let currentDate;
    let currentPlace;

    do {
        log.info(`Sleep...`);
        await new Promise(resolve => setTimeout(resolve, currentDate ? 1000000 : 10));
        currentDate = Math.floor(new Date().getTime() / 1000);

        const isLogged = await app.refreshBrowser();

        if (!isLogged) {
            log.warn(`Cookies expired, re-login now...`);
            await app.login();
        }

        if (!await app.syncCookiesFromWeb()) {
            log.error(`Error sync cookies, try again after timeout`);
            continue;
        }

        const needUpdate = await app.wallCheck();
        if (!needUpdate) {
            log.info(`Skip update...`);
            continue;
        }

        log.info(`Need update...`);
        let place = await app.getBTPlace();
        if (!place) {
            log.error(`Can't parse BT place, try again after timeout`);
            continue;
        }

        log.info(`Place === ${place}`);
        currentPlace = place;

        const emoji = sample([
            '\u{1F9E8}', // dynamite
            '\u{1F525}', // fire
            '\u{1F44C}', // ok hand
            '\u{270A}',  // fist
            '\u{1F44F}', // clap
            '\u{1F494}', // broken heart
            '\u{1F648}', // monkey
            '\u{1F47B}', // ghost
            '\u{1F608}', // purple head
            '\u{1F60E}', // glasses
            '\u{1F974}', // woozy
            '\u{1F4A3}', // bomb
            '\u{261D}\u{261D}\u{261D}', // auf
            '\u{1F9E0}', // brain
            '\u{1F57A}', // dance
            '\u{1F408}', // cat
            '\u{1F984}', // unicorn
            '\u{1F986}', // duck,
            '\u{1F40A}', // crocodile
            '\u{1F438}', // frog
            '\u{1F98B}', // butterfly
            '\u{1F34F}', // apple
            '\u{1F355}', // pizza
            '\u{1F36C}', // candy
            '\u{1F379}', // drink
            '\u{1F682}', // train
            '\u{1F680}', // rocket
            '\u{1F308}', // rainbow
            '\u{1F389}', // party
            '\u{1F5FF}', // allo
        ]);

        const days = Math.ceil(Math.abs(currentDate - startDate) / 86400);
        const deadline = Math.ceil((lastDate - currentDate) / 86400);

        let result;

        if (currentDate > startDate) {
            const win = place <= needPlace;
            if (win) {
                await app.wallPost(`\u{1F3C6} Лотерея завершена на ${days} дн. (осталось: ${deadline})\n`
                    + `Выпал бочонок #${currentPlace}, поздравляем!`);
                break;
            }

            const loseText = sample([
                'Увы, победа не сегодня',
                'Возможно завтра победим',
                'Бочонок пытался, не удалось',
                'Я обязательно выживу...',
                'Сегодня читал книжку про java, не успел',
                'Завтра перезвоню',
                'Отстаньте, пожалуйста',
                'Я вам ничего не должен',
                'Сегодня велосипед',
                'Жалко продуктов нет нормальных (в холодильнике)',
                '[голосовое сообщение]',
                'Сегодня написал трек новый',
            ]);

            result = await app.wallPost(`${emoji} НЕТ\n\n Лотерея идёт уже ${days} дн. (осталось: ${deadline})\n`
                                           + `Сегодня выпал бочонок #${currentPlace}\n\n«${loseText}»`);

        } else {
            result = await app.wallPost(`${emoji} Начало лотереи через ${days} дн.`);
        }

        if (!result) {
            log.error('wallPost error!');
        }

    } while (currentDate <= lastDate || currentPlace <= needPlace);

    log.info('Done.');
})();
