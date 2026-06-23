# まゆこAI会社 公開用

スマホから開くための公開用静的HTMLです。

ローカル版とは分けてあります。公開する場合は、この `public/` フォルダだけを使います。

## 入っているもの

- AI社員名
- 部署名
- 役割
- 初期プロンプト
- 状態ラベル
- 次の一手
- ChatGPTチャットURL欄
- オフィス背景画像
- AI社員キャラ画像

## フロア構成

- `assets/office/floor-01-reception.png`: 1F 受付・案内フロア
- `assets/office/floor-02-workroom.png`: 2F 制作・開発フロア
- `assets/office/floor-03-strategy.png`: 3F 商品・戦略フロア
- `assets/office/floor-03-lounge.png`: 4F 整理・回復・内観フロア

## 入れないもの

- 個人情報
- 金額の詳細
- 深い内観ログ本文
- 秘密情報
- ローカルPCの場所がわかる情報
- 具体的すぎる個人運用情報

## 開き方

`public/index.html` を開きます。

ローカルで確認する場合:

```bash
cd mayuko-ai-office/public
python3 -m http.server 8090
```

ブラウザで開きます。

```text
http://localhost:8090
```

## ChatGPTチャットURLを入れる場所

`public/data/agents.json` の `chatUrl` に入れます。

```json
{
  "name": "社長補佐",
  "chatUrl": "https://chatgpt.com/c/公開してよいチャットURL"
}
```

深い相談ログや個人情報が入ったチャットURLは入れません。

## 公開前チェック

公開前に、次の文字が入っていないか確認します。

- 秘密情報
- ローカルPCの場所がわかる情報
- 金額の詳細
- 深い内観ログ本文

## GitHub Pages / Netlify

GitHub PagesやNetlifyで公開する場合は、公開対象を `public/` にします。

外部連携やサーバー処理は使っていません。静的HTMLとして表示します。

## 既存フォーム回答スプシで進捗を一括管理する

既存の「まゆこAIオフィス報告フォーム」の回答スプレッドシートを進捗管理の本体にします。

この1つのスプレッドシートに、次の2種類をまとめます。

- ChatGPT社員の【オフィス報告】
- public画面の「私のメモ」

GASを入れると、同じスプレッドシート内に次の2枚が作られます。

- `office_events`: フォーム報告とpublicメモの履歴
- `office_status`: プロジェクト × AI社員ごとの最新状態

`office_status` は `projectId + agentId` で管理します。
同じAI社員が複数プロジェクトに参加しても、別行になるので上書きされません。

手順:

1. 既存のフォーム回答スプレッドシートを開く
2. `拡張機能` → `Apps Script` を開く
3. `gas/office-memo-webapp.gs` の中身を貼る
4. `setupOfficeSheets` を選んで1回だけ実行する
5. 権限確認が出たら、自分のGoogleアカウントで許可する
6. `office_events` と `office_status` が作られたことを確認する
7. `デプロイ` → `新しいデプロイ` → `ウェブアプリ` を選ぶ
8. 実行するユーザーは `自分`
9. アクセスできるユーザーは、まず `全員` にする
10. 発行された `/exec` で終わるURLを `app.js` の `GAS_ENDPOINT` に貼る

注意:

- GASのURLを公開ページに入れると、そのURLを知っている人は送信できます
- メモには個人情報、金額、深い内観ログ、秘密情報を書かない運用にします
- APIキー、トークン、Webhook URLは使いません
- ChatGPT報告は `office_events` に履歴保存され、`office_status` の最新状態も更新します
- publicメモも同じ `office_events` に履歴保存され、同じ `office_status` の該当プロジェクト・AI社員行に反映します
- フォームに `プロジェクト名`、`今どこまで`、`何待ち` の項目を追加すると、public画面に出す進捗がより正確になります
- `プロジェクト名` がないフォーム報告は、まず `まゆこAIオフィス` として扱います
- `app.js` の `GAS_ENDPOINT` にURLを入れると、public画面は `office_status` の `mayuko-ai-office` だけを読み込んで表示します
- `GAS_ENDPOINT` が空の間は、今まで通り `data/tasks.json` を表示します

## GitHub Pagesに公開する手順

CodexからGitHub操作ができる状態なら、この `public/` フォルダだけを新しいリポジトリへアップします。

手動で進める場合:

```bash
cd mayuko-ai-office/public
git init
git add .
git commit -m "Publish Mayuko AI Office"
gh repo create mayuko-ai-office-public --public --source=. --remote=origin --push
gh repo edit mayuko-ai-office-public --enable-pages
```

GitHub Pagesの公開元は、`main` ブランチのルートを選びます。
