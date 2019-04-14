# Serverless Nuxt Deploy

通常の使い方
```
sls deploy --stage {stage}
```

ストレージだけ個別
```
sls storage:deploy --stage {stage}
sls storage:remove --stage {stage}
```

serverless.ymlの設定
```
...

custom:
  nuxtDeploy:
    sync:
      - path: _nuxt
        type: s3
        localDir: .nuxt/dist/client
      - path: img
        type: s3
        localDir: app/static/img

```
