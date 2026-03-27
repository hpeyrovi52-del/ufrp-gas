function sw_getOutput_() {
  return HtmlService.createHtmlOutputFromFile("sw")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}