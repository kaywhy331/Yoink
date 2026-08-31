fetch("/api/v1/user/privacy/policy-viewed", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
}).catch(() => undefined);
