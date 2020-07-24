const chalk = require('chalk')
class ServerlessBase {
    constructor(serverless, options, credentials=null) {
        this.serverless = serverless
        this.options = options
        // params
        this.serviceName = this.serverless.service.service
        this.servicePath = this.serverless.service.serverless.config.servicePath
        this.region = this.serverless.service.provider.region.replace(/\r\n/g, '')
        this.stage = this.options.stage || this.serverless.service.provider.stage
        this.basename = `${this.serviceName}-${this.stage}`
        this.serviceBucketName = `${this.basename}`
    }
    title(text, color='green') {
        this.serverless.cli.consoleLog(chalk[color](text))
    }
    info(text, color='white') {
        this.serverless.cli.consoleLog(chalk[color](text))
    }
    warn(text, color='yellow') {
        this.serverless.cli.consoleLog(chalk[color](text))
    }
    error(text, color='red') {
        this.serverless.cli.consoleLog(chalk[color](text))
    }

}
module.exports = ServerlessBase