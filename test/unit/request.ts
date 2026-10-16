import * as http from "node:http";

/** Makes an HTTP request, resolving with its status and body as text. */
export function request(url: string, method = "GET", body?: Uint8Array): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (part) => (data += part));
      res.on("end", () => resolve({ status: res.statusCode!, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
