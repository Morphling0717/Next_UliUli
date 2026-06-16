UPDATE site_config
SET value = replace(
  value,
  'https://api.uliuli.cc/api',
  'https://1377297588-5v9c60xnw1.ap-guangzhou.tencentscf.com/?mid=3546779356235807'
)
WHERE key = 'site_config'
  AND value LIKE '%https://api.uliuli.cc/api%';
