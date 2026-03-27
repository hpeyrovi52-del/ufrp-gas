function doGet(e) {
  e = e || {};
  const p = e.parameter || {};

  if (String(p.sw || "") === "1") {
    return sw_getOutput_();
  }

  const view = String(p.view || "app");

  if (view === "form") {
    const formKey = String(p.formKey || "").trim();
    return router_renderForm_(formKey);
  }

  return router_renderApp_();
}