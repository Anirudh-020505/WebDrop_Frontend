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
    socketRef.current = new WebSocket("https://webdrop-backend.onrender.com/ws");

    socketRef.current.onopen = () => {
      socketRef.current.send(JSON.stringify({ type: "join", name: deviceName.current }));
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
            confirm(`${msg.from} wants to send you "${msg.fileName}" (${msg.fileSize} bytes). Accept?`)
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
            setMessages((m) => [...m, `Accepted "${msg.fileName}" from ${msg.from}.`]);
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
            setMessages((m) => [...m, `Rejected "${msg.fileName}" from ${msg.from}.`]);
          }
          break;

        case "file_response":
          if (msg.accepted) {
            setMessages((m) => [...m, `${msg.to} is ready — sending "${pendingFile.current.name}"`]);
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
            console.warn(`Chunk received for unknown transferId: ${transferId}`);
            return;
          }

          recv.chunks[chunkIndex] = data;
          setMessages((m) => [
            ...m,
            `Received chunk ${chunkIndex + 1}/${totalChunks} of "${recv.fileName}"`,
          ]);

          const receivedCount = recv.chunks.filter(Boolean).length;

          if (receivedCount === totalChunks) {
            const byteArrays = recv.chunks.map((b64) => {
              const binary = atob(b64);
              const arr = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
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
    socketRef.current.send(JSON.stringify({ type: "chat", name: deviceName.current, message: input }));
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
    <div className="p-6 font-sans">
      <h1 className="text-2xl mb-4 font-bold">📡 WebDrop</h1>
      <div className="mb-6">
        <h2 className="font-semibold mb-2">Online Devices:</h2>
        <div className="flex space-x-2">
          {clients.map((name) => (
            <button
              key={name}
              onClick={() => requestFile(name)}
              className="px-3 py-1 bg-green-200 rounded-full text-sm"
            >
              {name}
            </button>
          ))}
          {clients.length === 0 && (
            <span className="text-gray-500 text-sm">No one else online</span>
          )}
        </div>
      </div>
      <div className="mb-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="border px-3 py-2 rounded mr-2"
        />
        <button
          onClick={sendMessage}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Send
        </button>
      </div>
      <div className="bg-gray-100 p-4 rounded h-64 overflow-y-scroll">
        {messages.map((msg, i) => (
          <div key={i}>{msg}</div>
        ))}
      </div>
    </div>
  );
}

export default App;
