function router_renderApp_() {
  const t = HtmlService.createTemplateFromFile("Index");
  t.initialView = "menu";
  t.initialFormKey = "";
  return t
    .evaluate()
    .setTitle("Unified Financial Recording Platform")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function router_renderForm_(formKey) {
  const t = HtmlService.createTemplateFromFile("Index");
  t.initialView = "form";
  t.initialFormKey = String(formKey || "").trim();
  return t
    .evaluate()
    .setTitle("Unified Financial Recording Platform")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}