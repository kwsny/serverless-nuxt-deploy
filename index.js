const ServerlessBase = require('./libs/ServerlessBase')
const Storage = require('./libs/Storage')
const CloudFront = require('./libs/CloudFront')
class ServerlessNuxtDeploy extends ServerlessBase {

    constructor(serverless, options) {
        super(serverless, options)
        this.commands = {
            'storage:deploy': {
                lifecycleEvents: [
                    'deploy'
                ]
            },
            'storage:remove': {
                lifecycleEvents: [
                    'remove'
                ]
            },
            'cloudfront:deploy': {
                lifecycleEvents: [
                    'deploy'
                ]
            },
            'cloudfront:remove': {
                lifecycleEvents: [
                    'remove'
                ]
            }
        }
        this.hooks = {
            'after:deploy:deploy': this.hookWrapper.bind(this, this.deployAfter),
            'before:remove:remove': this.hookWrapper.bind(this, this.removeBefore),
            'storage:deploy:deploy': this.hookWrapper.bind(this, this.deployStorage),
            'storage:remove:remove': this.hookWrapper.bind(this, this.removeStorage),
            'cloudfront:deploy:deploy': this.hookWrapper.bind(this, this.deployCloudFront),
            'cloudfront:remove:remove': this.hookWrapper.bind(this, this.removeCloudFront)
        }
    }

    async hookWrapper(lifecycleFunc) {
        this.initializeVariables()
        return await lifecycleFunc.call(this)
    }

    initializeVariables() {
        // aws services
        const credentials = this.serverless.providers.aws.getCredentials()
        // subclasses
        this.storage = new Storage(this.serverless, this.options, credentials)
        this.cloudfront = new CloudFront(this.serverless, this.options, credentials)
    }

    async deployAfter() {
        return new Promise(async (resolve, reject) => {
            try {
                this.title(`[serverless-nuxt-deploy] start`)
                await this.storage.deploy()
                resolve(`[serverless-nuxt-deploy] finished`)
            } catch (err) {
                reject(`[serverless-nuxt-deploy] Error: ${err}`)
            }
        })
    }

    async removeBefore() {
        return new Promise(async (resolve, reject) => {
            this.title(`[serverless-nuxt-deploy] start`)
            await this.storage.remove().catch(err => {
                return reject(`[serverless-nuxt-deploy] Error: ${err}`)
            })
            resolve(`[serverless-nuxt-deploy] finished`)
        })
    }

    async deployStorage() {
        await this.storage.deploy()
    }

    async removeStorage() {
        await this.storage.remove()
    }

    async deployCloudFront() {
        await this.cloudfront.deploy()
    }

    async removeCloudFront() {
        await this.cloudfront.remove()
    }

}

module.exports = ServerlessNuxtDeploy
