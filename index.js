const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let gameState = "waiting";
let targetBingos = 1;
let players = {};
let drawnNumbers = [];
let previousWinners = []; // 직전 우승자 목록 추적
let lastDrawnNumber = null; // 방금 뽑은 번호 기억 (되돌리기 용)

function countBingos(board, drawn) {
    const winLines = [
        [0, 1, 2, 3, 4],
        [5, 6, 7, 8, 9],
        [10, 11, 12, 13, 14],
        [15, 16, 17, 18, 19],
        [20, 21, 22, 23, 24],
        [0, 5, 10, 15, 20],
        [1, 6, 11, 16, 21],
        [2, 7, 12, 17, 22],
        [3, 8, 13, 18, 23],
        [4, 9, 14, 19, 24],
        [0, 6, 12, 18, 24],
        [4, 8, 12, 16, 20],
    ];
    let count = 0;
    winLines.forEach((line) => {
        if (line.every((idx) => drawn.includes(board[idx]))) count++;
    });
    return count;
}

io.on("connection", (socket) => {
    socket.on("join_game", (nickname, callback) => {
        if (gameState !== "waiting") {
            return callback({
                success: false,
                message: "이미 게임이 시작되어 입장할 수 없습니다.",
            });
        }
        players[socket.id] = {
            nickname,
            board: [],
            ready: false,
            isWinner: false,
        };
        callback({ success: true });
        io.emit("update_players", Object.values(players));
    });

    socket.on("host_start_filling", (target) => {
        targetBingos = target;
        gameState = "filling";
        io.emit("phase_filling");
    });

    socket.on("guest_ready", (board) => {
        if (players[socket.id]) {
            players[socket.id].board = board;
            players[socket.id].ready = true;
            io.emit("update_players", Object.values(players));

            const allReady = Object.values(players).every((p) => p.ready);
            if (allReady && Object.keys(players).length > 0)
                io.emit("all_guests_ready");
        }
    });

    socket.on("guest_cancel_ready", () => {
        if (players[socket.id]) {
            players[socket.id].ready = false;
            io.emit("update_players", Object.values(players));
            io.emit("cancel_guests_ready");
        }
    });

    socket.on("host_start_drawing", () => {
        gameState = "playing";
        io.emit("phase_playing");
    });

    // [변경됨] 번호 토글 (추가 및 취소) 로직
    socket.on("host_toggle_number", (number) => {
        const index = drawnNumbers.indexOf(number);
        const isAdding = index === -1; // 배열에 없으면 추가, 있으면 취소

        if (isAdding) {
            drawnNumbers.push(number);
            lastDrawnNumber = number;
        } else {
            drawnNumbers.splice(index, 1); // 배열에서 제거 (취소)
            if (lastDrawnNumber === number) lastDrawnNumber = null;
        }

        // 전체 빙고 상태 재계산
        let currentWinners = [];
        for (let id in players) {
            let p = players[id];
            if (p.ready) {
                let bingos = countBingos(p.board, drawnNumbers);
                p.isWinner = bingos >= targetBingos;
                if (p.isWinner) currentWinners.push(p.nickname);
            }
        }

        // 바뀐 번호 리스트를 전체 클라이언트에 동기화
        io.emit("sync_board_state", drawnNumbers);

        if (isAdding) {
            // 새롭게 추가된 우승자만 필터링해서 팝업 띄우기
            let newWinners = currentWinners.filter(
                (w) => !previousWinners.includes(w),
            );
            if (newWinners.length > 0) io.emit("announce_winners", newWinners);
        } else {
            // 번호를 취소해서 우승자가 바뀌었을 수 있으므로 업데이트 신호 전송
            io.emit("retract_winners", currentWinners);
        }
        previousWinners = currentWinners;
    });

    // [추가됨] 팝업창에서 직전 추첨 되돌리기
    socket.on("host_undo_last_draw", () => {
        if (lastDrawnNumber !== null) {
            drawnNumbers = drawnNumbers.filter((n) => n !== lastDrawnNumber);
            lastDrawnNumber = null;

            let currentWinners = [];
            for (let id in players) {
                let p = players[id];
                if (p.ready) {
                    let bingos = countBingos(p.board, drawnNumbers);
                    p.isWinner = bingos >= targetBingos;
                    if (p.isWinner) currentWinners.push(p.nickname);
                }
            }

            io.emit("sync_board_state", drawnNumbers);
            io.emit("retract_winners", currentWinners); // 팝업 닫고 패널 업데이트
            previousWinners = currentWinners;
        }
    });

    socket.on("host_continue_game", () => {
        io.emit("game_continued");
    });

    socket.on("host_end_game", () => {
        gameState = "waiting";
        drawnNumbers = [];
        previousWinners = [];
        lastDrawnNumber = null;
        for (let id in players) {
            players[id].board = [];
            players[id].ready = false;
            players[id].isWinner = false;
        }
        io.emit("game_ended_reset");
        io.emit("update_players", Object.values(players));
    });

    socket.on("disconnect", () => {
        delete players[socket.id];
        io.emit("update_players", Object.values(players));

        if (gameState === "filling" && Object.keys(players).length > 0) {
            const allReady = Object.values(players).every((p) => p.ready);
            if (allReady) io.emit("all_guests_ready");
            else io.emit("cancel_guests_ready");
        }
    });
});

// process.env.PORT를 추가하여 클라우드 서버 환경에 맞춥니다.
server.listen(process.env.PORT || 3000, () => {
    console.log("빙고 서버가 실행 중입니다.");
});
