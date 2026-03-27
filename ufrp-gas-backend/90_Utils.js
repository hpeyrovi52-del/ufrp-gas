function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function _pendingFolderName_() {
  return "_PENDING";
}