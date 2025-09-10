const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3001;

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://192.168.1.7:3000",
      "https://infinite-tic-tac-toe-front.vercel.app",
    ],
    methods: ["GET", "POST"],
  },
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.json("API JOGO DA VELHA");
});

const rooms = {};

function generateRoomCode(length = 5) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on("connection", (socket) => {
  console.log("a user connected", socket.id);

  socket.on("disconnect", () => {
    console.log("user disconnected", socket.id);
    if (Object.values(rooms).length === 0) return;
    const room = Object.values(rooms).find((r) =>
      r.players.some((p) => p.id === socket.id)
    );
    if (!room) return;

    if (room.players.length === 1) {
      const roomCode = Object.keys(rooms).find((code) => rooms[code] === room);
      delete rooms[roomCode];
      return;
    }

    const playerSymbol = room.players.find((p) => p.id === socket.id)?.symbol;

    room.players = room.players.filter((p) => p.id !== socket.id);

    const otherPlayer = room.players.find((p) => p.id !== socket.id);
    if (otherPlayer) {
      io.to(otherPlayer.id).emit("player-left", {
        leftSymbol: playerSymbol,
      });
    }
  });

  socket.on("create-room", ({ isPublic = true }) => {
    console.log("create-room chamado, isPublic:", isPublic);
    let code;
    do {
      code = generateRoomCode();
    } while (rooms[code]);

    rooms[code] = {
      players: [{ id: socket.id, symbol: "X", moves: [] }],
      board: Array(9).fill(null),
      turn: "X",
      public: isPublic,
    };

    socket.join(code);
    socket.emit("room-created", {
      code,
      symbol: "X",
      board: rooms[code].board,
      turn: rooms[code].turn,
    });
  });

  socket.on("join-room", ({ code }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit("error", "Sala não existe");
      return;
    }
    if (room.players.length >= 2) {
      socket.emit("error", "Sala cheia");
      return;
    }

    // so entrar limpar o tabuleiro se for o segundo jogador
    room.board = Array(9).fill(null);
    room.turn = "X";

    const availableSymbol =
      room.players.find((p) => p.id !== socket.id)?.symbol === "X" ? "O" : "X";

    room.players.push({ id: socket.id, symbol: availableSymbol, moves: [] });
    socket.join(code);

    socket.emit("room-joined", {
      board: room.board,
      symbol: availableSymbol,
      turn: room.turn,
    });

    const otherPlayer = room.players.find((p) => p.id !== socket.id);
    if (otherPlayer) {
      io.to(otherPlayer.id).emit("player-joined", {
        board: room.board,
        turn: room.turn,
      });
    }
  });

  socket.on("join-random-room", () => {
    const availableRoomCode = Object.keys(rooms).find(
      (code) => rooms[code].players.length === 1 && rooms[code].public
    );

    if (availableRoomCode) {
      // Chama a lógica do join-room direto no servidor
      const room = rooms[availableRoomCode];
      const availableSymbol = room.players[0].symbol === "X" ? "O" : "X";

      room.board = Array(9).fill(null);
      room.turn = "X";

      room.players.push({ id: socket.id, symbol: availableSymbol, moves: [] });
      socket.join(availableRoomCode);

      socket.emit("room-joined", {
        roomCode: availableRoomCode,
        board: room.board,
        symbol: availableSymbol,
        turn: room.turn,
      });

      const otherPlayer = room.players.find((p) => p.id !== socket.id);
      if (otherPlayer) {
        io.to(otherPlayer.id).emit("player-joined", {
          board: room.board,
          turn: room.turn,
        });
      }
    }
  });

  socket.on("leave-room", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    socket.leave(roomCode);

    if (room.players.length === 0) {
      delete rooms[roomCode];
    } else {
      const otherPlayer = room.players[0];
      io.to(otherPlayer.id).emit("player-left", {
        leftSymbol: player.symbol,
      });
    }
    socket.emit("left-room");
  });

  socket.on("rematch", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.board = Array(9).fill(null);
    room.turn = "X";
    room.players.forEach((p) => (p.moves = []));

    io.to(roomCode).emit("rematch-started", {
      board: room.board,
      turn: room.turn,
    });
  });

  socket.on("make-move", ({ roomCode, index }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    if (room.turn !== player.symbol) return;
    if (room.board[index]) return;

    if (player.moves.length === 3) {
      const oldIndex = player.moves.shift();
      room.board[oldIndex] = null;
    }

    let nextDisappear = null;
    room.players.forEach((p) => {
      if (p.moves.length >= 3) {
        nextDisappear = p.moves[0];
      }
    });
    io.to(roomCode).emit("next-disappear", nextDisappear);

    room.board[index] = player.symbol;
    player.moves.push(index);

    // Alterna turno
    room.turn = room.turn === "X" ? "O" : "X";

    // Verifica vitória
    let winner = null;
    const winningCombinations = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];
    for (const [a, b, c] of winningCombinations) {
      if (
        room.board[a] &&
        room.board[a] === room.board[b] &&
        room.board[a] === room.board[c]
      ) {
        winner = room.board[a];
        break;
      }
    }

    io.to(roomCode).emit("move-made", {
      board: room.board,
      turn: room.turn,
      winner,
    });
  });
});
