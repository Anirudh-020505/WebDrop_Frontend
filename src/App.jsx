import { useEffect, useRef, useState } from "react";

function App() {
  const [clients, setClients] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const socketRef = useRef(null);
  const deviceName = useRef("User" + Math.floor(Math.random() * 1000));
  const pendingFile = useRef(null);
  const receivers = useRef({});

  useEffect(() => {
    socketRef.current = new WebSocket(
      "https://webdrop-backend.onrender.com/ws"
    );

    socketRef.current.onopen = () => {
      socketRef.current.send(
        JSON.stringify({ type: "join", name: deviceName.current })
      );
    };

    socketRef.current.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "presence":
          setClients(msg.clients.filter((c) => c !== deviceName.current));
          break;

        case "chat":
          setMessages((m) => [...m, `${msg.name}: ${msg.message}`]);
          break;

        case "file_request":
          if (
            confirm(
              `${msg.from} wants to send you "${msg.fileName}" (${msg.fileSize} bytes). Accept?`
            )
          ) {
            socketRef.current.send(
              JSON.stringify({
                type: "file_response",
                from: deviceName.current,
                to: msg.from,
                accepted: true,
                transferId: msg.transferId,
                fileName: msg.fileName,
                totalChunks: msg.totalChunks,
              })
            );
            receivers.current[msg.transferId] = {
              fileName: msg.fileName,
              totalChunks: msg.totalChunks,
              chunks: [],
            };
            setMessages((m) => [
              ...m,
              `Accepted "${msg.fileName}" from ${msg.from}.`,
            ]);
          } else {
            socketRef.current.send(
              JSON.stringify({
                type: "file_response",
                from: deviceName.current,
                to: msg.from,
                accepted: false,
                transferId: msg.transferId,
              })
            );
            setMessages((m) => [
              ...m,
              `Rejected "${msg.fileName}" from ${msg.from}.`,
            ]);
          }
          break;

        case "file_response":
          if (msg.accepted) {
            setMessages((m) => [
              ...m,
              `${msg.to} is ready — sending "${pendingFile.current.name}"`,
            ]);
            sendFileChunks(msg.to, msg.transferId);
          } else {
            setMessages((m) => [...m, `${msg.to} rejected your transfer.`]);
            pendingFile.current = null;
          }
          break;

        case "file_chunk": {
          const { transferId, chunkIndex, totalChunks, data } = msg;
          const recv = receivers.current[transferId];
          if (!recv) {
            console.warn(
              `Chunk received for unknown transferId: ${transferId}`
            );
            return;
          }

          recv.chunks[chunkIndex] = data;
          setMessages((m) => [
            ...m,
            `Received chunk ${chunkIndex + 1}/${totalChunks} of "${
              recv.fileName
            }"`,
          ]);

          const receivedCount = recv.chunks.filter(Boolean).length;

          if (receivedCount === totalChunks) {
            const byteArrays = recv.chunks.map((b64) => {
              const binary = atob(b64);
              const arr = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++)
                arr[i] = binary.charCodeAt(i);
              return arr;
            });
            const blob = new Blob(byteArrays);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = recv.fileName;

            // Delay ensures blob is ready and DOM is stable
            setTimeout(() => {
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              setMessages((m) => [...m, `Download ready: ${recv.fileName}`]);
              delete receivers.current[transferId];
            }, 300);
          }
          break;
        }

        default:
          console.warn("Unhandled message type:", msg);
      }
    };

    return () => socketRef.current?.close();
  }, []);

  const sendMessage = () => {
    if (!input.trim()) return;
    socketRef.current.send(
      JSON.stringify({ type: "chat", name: deviceName.current, message: input })
    );
    setMessages((m) => [...m, `You: ${input}`]);
    setInput("");
  };

  const requestFile = (recipient) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;

      pendingFile.current = file;
      const transferId = `${deviceName.current}-${Date.now()}`;
      const totalChunks = Math.ceil(file.size / (64 * 1024));

      socketRef.current.send(
        JSON.stringify({
          type: "file_request",
          from: deviceName.current,
          to: recipient,
          transferId,
          fileName: file.name,
          fileSize: file.size,
          totalChunks,
        })
      );

      setMessages((m) => [...m, `Requested "${file.name}" to ${recipient}`]);
    };
    fileInput.click();
  };

  const sendFileChunks = async (recipient, transferId) => {
    const file = pendingFile.current;
    const chunkSize = 64 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const blob = file.slice(start, start + chunkSize);
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const b64 = btoa(binary);

      socketRef.current.send(
        JSON.stringify({
          type: "file_chunk",
          from: deviceName.current,
          to: recipient,
          transferId,
          chunkIndex: i,
          totalChunks,
          data: b64,
        })
      );

      setMessages((m) => [...m, `Sent chunk ${i + 1}/${totalChunks}`]);
    }

    pendingFile.current = null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6 font-sans">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl mb-6 font-bold text-blue-400 flex items-center">
          <span className="mr-2">📡</span> WebDrop
        </h1>

        <div className="mb-6 bg-gray-800 rounded-lg p-4 shadow-lg">
          <h2 className="font-semibold mb-3 text-blue-300">Online Devices</h2>
          <div className="flex flex-wrap gap-2">
            {clients.map((name) => (
              <button
                key={name}
                onClick={() => requestFile(name)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-full text-sm transition-colors duration-200 flex items-center"
              >
                <span className="w-2 h-2 bg-green-400 rounded-full mr-2"></span>
                {name}
              </button>
            ))}
            {clients.length === 0 && (
              <span className="text-gray-400 text-sm">No one else online</span>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 shadow-lg mb-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 bg-gray-700 text-white border border-gray-600 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyPress={(e) => e.key === "Enter" && sendMessage()}
            />
            <button
              onClick={sendMessage}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors duration-200"
            >
              Send
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 shadow-lg h-[400px] overflow-y-auto">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`mb-2 p-3 rounded-lg ${
                msg.startsWith("You:")
                  ? "bg-blue-600 ml-auto max-w-[80%]"
                  : "bg-gray-700 max-w-[80%]"
              }`}
            >
              {msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
