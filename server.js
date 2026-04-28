const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ===== GAME STATE =====
let gameState = {
  phase: 'waiting', // waiting | question | reveal | scoreboard | final
  questions: [],
  currentQIndex: -1,
  players: {},       // name -> score
  answers: {},       // name -> { choice, time }
  questionStartTime: null,
  timeLimit: 15,
};

// ===== BROADCAST =====
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function broadcastState() {
  broadcast({ type: 'state', state: gameState });
}

// ===== WS HANDLER =====
wss.on('connection', (ws) => {
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'state', state: gameState }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'join': {
        const name = (msg.name || '').trim().slice(0, 20);
        if (!name) return;
        if (!gameState.players[name]) gameState.players[name] = 0;
        broadcastState();
        break;
      }

      case 'add_question': {
        const { text, choices, correct } = msg;
        if (!text || !choices || correct === undefined) return;
        gameState.questions.push({ text, choices, correct });
        broadcastState();
        break;
      }

      case 'delete_question': {
        const idx = msg.index;
        if (idx >= 0 && idx < gameState.questions.length) {
          gameState.questions.splice(idx, 1);
          broadcastState();
        }
        break;
      }

      case 'start_question': {
        const next = gameState.currentQIndex + 1;
        if (next >= gameState.questions.length) return;
        gameState.phase = 'question';
        gameState.currentQIndex = next;
        gameState.answers = {};
        gameState.questionStartTime = Date.now();
        broadcastState();

        // Auto-reveal after timeLimit
        setTimeout(() => {
          if (gameState.phase === 'question' && gameState.currentQIndex === next) {
            revealAnswer();
          }
        }, gameState.timeLimit * 1000 + 500);
        break;
      }

      case 'reveal_answer': {
        revealAnswer();
        break;
      }

      case 'submit_answer': {
        const { name, choice } = msg;
        if (!name || choice === undefined) return;
        if (gameState.phase !== 'question') return;
        if (gameState.answers[name]) return; // already answered
        const elapsed = Date.now() - gameState.questionStartTime;
        gameState.answers[name] = { choice, time: elapsed };
        broadcastState();
        break;
      }

      case 'show_scoreboard': {
        gameState.phase = 'scoreboard';
        broadcastState();
        break;
      }

      case 'show_final': {
        gameState.phase = 'final';
        broadcastState();
        break;
      }

      case 'reset': {
        gameState = {
          phase: 'waiting',
          questions: [],
          currentQIndex: -1,
          players: {},
          answers: {},
          questionStartTime: null,
          timeLimit: 15,
        };
        broadcastState();
        break;
      }
    }
  });
});

function revealAnswer() {
  gameState.phase = 'reveal';
  const q = gameState.questions[gameState.currentQIndex];
  Object.entries(gameState.answers).forEach(([name, ans]) => {
    if (ans.choice === q.correct) {
      const elapsed = ans.time / 1000;
      const pts = Math.max(500, Math.round(1000 - (elapsed / gameState.timeLimit) * 500));
      gameState.players[name] = (gameState.players[name] || 0) + pts;
    }
  });
  broadcastState();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎉 Quiz server running on port ${PORT}`);
});
