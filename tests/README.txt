Developer tests (optional, not needed in production)
  node tests/gas_mock_test.js          # Code.gs on a mocked Google Sheets
  node tests/mock_server.js &          # mock API on :8787 (serves dummy test questions only)
  python3 -m http.server 8000 &        # serve the project root
  python3 tests/e2e.py                 # Playwright browser test of the student journey (needs: pip install playwright)
