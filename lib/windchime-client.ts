import { createWindChimeClient, createWindChimeLiveClient } from "@windchime/embed/client";

// Same-origin HttpOnly sessions stay entirely owned by this website.
export const mailClient = createWindChimeClient({
  baseUrl: "/api/mail",
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("mail:unauthorized"));
    }
    return response;
  },
});

export const mailLiveClient = createWindChimeLiveClient({
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("mail:unauthorized"));
    return response;
  },
});
