const BASE_URL = "http://127.0.0.1:3000";

export function request(options) {
  return new Promise((resolve, reject) => {
    tt.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      header: {
        "content-type": "application/json",
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(JSON.stringify(res.data || {})));
      },
      fail: (error) => reject(error),
    });
  });
}
