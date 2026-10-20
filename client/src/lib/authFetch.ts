export function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("authToken");
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  }).then((res) => {
    if (res.status === 401) {
      localStorage.removeItem("authToken");
      window.location.href = "/login";
    }
    return res;
  });
}
