import { Got } from 'got';
import { Logger, LoggerType } from 'lib-dd-helpers';

class VkLib {
    private static readonly VK_API_VERSION = '5.126';

    private readonly tokenVk: string;
    private readonly loginUrl: string;

    private got: Got;
    private log: LoggerType;
    private user;
    private isLogged: boolean;


    public getIsLogged() {
        return this.isLogged;
    }

    public getUser() {
        return this.user;
    }

    constructor(got, { token, loginUrl }) {
        this.log = Logger.getInstance().getLogger('VK');

        this.tokenVk = token;
        this.loginUrl = loginUrl;

        if (!this.tokenVk || !this.loginUrl) {
            this.log.error(`No token or login url`);
        }

        this.got = got
    }

    public async getMe() {
        const result: any = await this.apiVkCall('account.getProfileInfo', {}, true);

        if (!result.response.id) {
            return null;
        }

        this.user = {
            id: result.response.id,
            firstName: result.response.first_name,
            lastName: result.response.last_name,
        };

        this.log.info(`Logged as ${this.user.firstName} ${this.user.lastName}`);
        this.isLogged = true;

        return true;
    }

    public async apiVkCall(method, params, force = false): Promise<any> {
        if (!force && !this.isLogged) {
            this.log.error(`Can't call VK without login`);
            return null;
        }

        const result = await this.got.post(`https://api.vk.com/method/${method}`, {
            searchParams: {
                access_token: this.tokenVk,
                v: VkLib.VK_API_VERSION,
                ...params,
            }
        }).json();

        const error = this.checkError(result);

        if (error) {
            this.log.error(error);
            return null;
        }

        return result;
    }

    private checkError(response): string {
        if (!response?.error) {
            return null;
        }

        if (response.error?.error_code === 5) {
            this.log.error(`Old token, use url: ${this.loginUrl}`);
        }

        return response.error?.error_msg;
    }
}

export { VkLib };
