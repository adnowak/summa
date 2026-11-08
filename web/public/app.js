const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send");
const replyEl = document.getElementById("reply");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) {
    return;
  }

  sendButton.disabled = true;
  replyEl.textContent = "Waiting for reply…";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    if (!response.ok) {
      replyEl.textContent = data.error || "Request failed.";
      return;
    }
    replyEl.textContent = data.reply;
  } catch (err) {
    replyEl.textContent = `Could not reach the server: ${err.message}`;
  } finally {
    sendButton.disabled = false;
  }
});
