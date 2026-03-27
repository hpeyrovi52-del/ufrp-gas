<?php
header("Content-Type: application/json; charset=utf-8");
http_response_code(200);
echo json_encode([
  "ok" => true,
  "serverReachable" => true,
  "time" => gmdate("c")
], JSON_UNESCAPED_UNICODE);
