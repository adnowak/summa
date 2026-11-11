const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send");
const replyEl = document.getElementById("reply");

const knowledgeForm = document.getElementById("knowledge-form");
const labelInput = document.getElementById("knowledge-label");
const textInput = document.getElementById("knowledge-text");
const saveButton = document.getElementById("save");
const knowledgeError = document.getElementById("knowledge-error");
const savedLabel = document.getElementById("saved-label");
const savedText = document.getElementById("saved-text");

function showStatement(statement) {
  knowledgeError.textContent = "";
  if (!statement) {
    savedLabel.textContent = "No statement saved.";
    savedText.textContent = "";
    savedText.hidden = true;
    return;
  }
  labelInput.value = statement.label;
  textInput.value = statement.text;
  savedLabel.textContent = statement.label;
  savedText.hidden = false;
  savedText.textContent = statement.text;
}

async function loadStatement() {
  try {
    const response = await fetch("/api/knowledge");
    const data = await response.json();
    if (!response.ok) {
      knowledgeError.textContent = data.error || "Could not load the statement.";
      return;
    }
    showStatement(data.statement);
  } catch (err) {
    knowledgeError.textContent = `Could not reach the server: ${err.message}`;
  }
}

knowledgeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  knowledgeError.textContent = "";
  try {
    const response = await fetch("/api/knowledge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: labelInput.value,
        text: textInput.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      knowledgeError.textContent = data.error || "Could not save the statement.";
      return;
    }
    showStatement(data.statement);
  } catch (err) {
    knowledgeError.textContent = `Could not reach the server: ${err.message}`;
  } finally {
    saveButton.disabled = false;
  }
});

loadStatement();

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
