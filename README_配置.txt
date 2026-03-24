この zip は GitHub Pages 用の docs/ 完成セットです。

配置:
- 中の docs/ フォルダを、そのままリポジトリ直下に置いてください。
- GitHub の Settings > Pages で、Branch=main / Folder=/docs を選んで公開します。

同梱内容:
- index.html
- race_detail.html
- past_detail.html
- betting.html
- static/index.js
- static/style.css
- static/race.js
- static/past.js
- static/betting.js
- data/index.json
- data/20260322/races.json
- data/20260322/race_202606020801.json
- .nojekyll

注意:
- data/ 配下はサンプルです。ご自身で build_pages_json.py を実行したら、生成された data/ に置き換えてください。
- URL 例:
  race_detail.html?date=20260322&race_id=202606020801
  past_detail.html?date=20260322&race_id=202606020801
  betting.html?date=20260322&race_id=202606020801
