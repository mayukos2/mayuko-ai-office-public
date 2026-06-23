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
