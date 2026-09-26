fetch("/api/v1/user/privacy/policy-viewed", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Yoink-Request": "1" },
  body: "{}"
}).catch(() => undefined);
