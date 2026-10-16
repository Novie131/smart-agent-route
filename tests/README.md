# 測試

只用 Python 標準函式庫。在 repo 根目錄執行：

    python3 -m unittest discover -s tests -v

測試一律使用暫存目錄與假的 HOME，不會動到真實的 ~/.claude。
CI 設定在 .github/workflows/ci.yml。
