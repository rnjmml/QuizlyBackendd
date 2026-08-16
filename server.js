const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const DB_BASE = "https://priornetwork.com/web/ranijumamil/db/quizly/users";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = "openrouter/free";

function dbHeaders() {
    return {
        "Content-Type": "application/json",
        "x-api-key": process.env.QUIZLY_RW_KEY
    };
}

app.get("/", (req, res) => {
    res.send("Quizly backend is running!");
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        ai: !!process.env.OPENROUTER_API_KEY
    });
});

app.get("/test-version", (req, res) => {
    res.json({
        version: "matchmaking-vote-added",
        voteRoute: "exists"
    });
});

app.post("/test-post", (req, res) => {
    res.json({
        message: "POST routes are working"
    });
});

/* =========================
   AI QUIZ
========================= */

const quizSchema = {
    type: "object",
    properties: {
        questions: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    question: {
                        type: "string"
                    },
                    options: {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        minItems: 4,
                        maxItems: 4
                    },
                    answer: {
                        type: "string"
                    },
                    explanation: {
                        type: "string"
                    }
                },
                required: [
                    "question",
                    "options",
                    "answer",
                    "explanation"
                ],
                additionalProperties: false
            }
        }
    },
    required: ["questions"],
    additionalProperties: false
};

function extractJson(content) {
    if (!content) {
        return null;
    }

    if (typeof content !== "string") {
        return null;
    }

    let text = content.trim();

    text = text.replace(/```json/gi, "");
    text = text.replace(/```/g, "");
    text = text.trim();

    try {
        return JSON.parse(text);
    } catch (error) {
    }

    const start = text.indexOf("{");

    if (start === -1) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === "\\") {
            escaped = true;
            continue;
        }

        if (char === '"' && !escaped) {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === "{") {
            depth++;
        }

        if (char === "}") {
            depth--;

            if (depth === 0) {
                const possibleJson = text.substring(start, i + 1);

                try {
                    return JSON.parse(possibleJson);
                } catch (error) {
                    return null;
                }
            }
        }
    }

    return null;
}

function validateQuiz(quiz, count) {
    if (!quiz) {
        return null;
    }

    if (!quiz.questions || !Array.isArray(quiz.questions)) {
        return null;
    }

    if (quiz.questions.length < count) {
        console.log(
            `AI returned ${quiz.questions.length} questions instead of ${count}`
        );

        return null;
    }

    const questions = quiz.questions
        .slice(0, count)
        .filter(function(q) {

            if (!q) {
                return false;
            }

            if (typeof q.question !== "string") {
                return false;
            }

            if (!Array.isArray(q.options)) {
                return false;
            }

            if (q.options.length !== 4) {
                return false;
            }

            if (typeof q.answer !== "string") {
                return false;
            }

            const answer = q.answer.trim().toLowerCase();

            const validAnswer = q.options.some(function(option) {
                return String(option).trim().toLowerCase() === answer;
            });

            return validAnswer;
        })
        .map(function(q) {

            return {
                question: q.question.trim(),

                options: q.options.map(function(option) {
                    return String(option).trim();
                }),

                answer: q.answer.trim(),

                explanation: q.explanation
                    ? String(q.explanation).trim()
                    : ""
            };
        });

    if (questions.length !== count) {
        console.log(
            `Only ${questions.length} valid questions were received`
        );

        return null;
    }

    return questions;
}

async function createAIQuiz(subject, mode, questionCount) {

    console.log("AI SUBJECT RECEIVED:", subject);
    
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error("OPENROUTER_API_KEY is missing");
    }

    const count = Math.min(
        Math.max(Number(questionCount) || 10, 1),
        20
    );

    const subjectRules = {
        English:
            "English language, grammar, vocabulary, reading comprehension, and basic literature",

        Math:
            "mathematics appropriate for students, including arithmetic, algebra, geometry, and problem solving",

        Science:
            "general science, biology, chemistry, physics, Earth science, and basic scientific concepts"
    };

    const topic =
        subjectRules[subject] || subjectRules.English;

    const difficulty =
        mode === "Compete"
            ? "moderate difficulty with some challenging questions"
            : "beginner to moderate difficulty";

    const prompt = `
Create a quiz for the educational game QuiZly.

Subject: ${subject}
Mode: ${mode}
Number of questions: ${count}
Difficulty: ${difficulty}

The questions must focus on:
${topic}

Create exactly ${count} multiple-choice questions.

Every question must have:
- exactly 4 options
- exactly 1 correct answer
- an answer that exactly matches one of the options
- a short explanation

Rules:
- Do not repeat questions.
- Do not use "All of the above".
- Do not use "None of the above".
- Keep the questions appropriate for students.
- Keep explanations short.
- Do not add any text outside the JSON response.
`;

    console.log("=================================");
    console.log("CREATING AI QUIZ");
    console.log("Model:", AI_MODEL);
    console.log("Subject:", subject);
    console.log("Mode:", mode);
    console.log("Questions:", count);
    console.log("=================================");

    try {

        const response = await axios.post(
            OPENROUTER_URL,
            {
                model: AI_MODEL,

                messages: [
                    {
                        role: "system",
                        content:
                            "You create accurate educational multiple-choice quizzes. Return only JSON that follows the requested schema."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],

                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "quiz",
                        strict: true,
                        schema: quizSchema
                    }
                },

                plugins: [
                    {
                        id: "response-healing"
                    }
                ],

                provider: {
                    require_parameters: true
                },

                temperature: 0.3,

                max_tokens: 5000
            },
            {
                headers: {
                    "Content-Type": "application/json",

                    "Authorization":
                        `Bearer ${process.env.OPENROUTER_API_KEY}`,

                    "HTTP-Referer":
                        "https://quizlybackendd.onrender.com",

                    "X-Title":
                        "QuiZly"
                },

                timeout: 60000
            }
        );

        console.log("OpenRouter status:", response.status);
        console.log("OpenRouter model:", response.data?.model);

        const message = response.data?.choices?.[0]?.message;

        if (!message) {
            throw new Error(
                "OpenRouter did not return a message."
            );
        }

        let content = message.content;

        if (Array.isArray(content)) {

            content = content
                .filter(function(item) {
                    return item && item.type === "text";
                })
                .map(function(item) {
                    return item.text || "";
                })
                .join("");
        }

        console.log("AI response received.");

        const quiz = extractJson(content);

        if (!quiz) {

            console.log("INVALID AI JSON");
            console.log("RAW AI RESPONSE:");
            console.log(content);

            throw new Error(
                "The AI returned an invalid quiz format."
            );
        }

        const questions = validateQuiz(
            quiz,
            count
        );

        if (!questions) {

            console.log("AI QUIZ VALIDATION FAILED");

            throw new Error(
                "The AI did not return the required number of valid questions."
            );
        }

        console.log(
            `AI quiz successfully created with ${questions.length} questions.`
        );

        return {
            subject: subject,
            mode: mode,
            questions: questions
        };

    } catch (error) {

        console.log("=================================");
        console.log("AI QUIZ ERROR");
        console.log("=================================");

        if (error.response) {

            console.log(
                "OpenRouter status:",
                error.response.status
            );

            console.log(
                "OpenRouter response:"
            );

            console.log(
                JSON.stringify(
                    error.response.data,
                    null,
                    2
                )
            );

            throw new Error(
                error.response.data?.error?.message ||
                error.response.data?.message ||
                "OpenRouter request failed."
            );
        }

        console.log(
            "Error:",
            error.message
        );

        throw error;
    }
}

/*
   This endpoint is still available for Study mode.

   IMPORTANT:
   Matchmaking should NOT use this endpoint.
*/

app.post("/quiz", async (req, res) => {

    console.log("QUIZ REQUEST RECEIVED");

    const {
        subject = "English",
        mode = "Study",
        questionCount = 10
    } = req.body;

    try {

        const quiz = await createAIQuiz(
            subject,
            mode,
            questionCount
        );

        res.status(200).json(quiz);

    } catch (error) {

        console.log(
            "QUIZ CREATION FAILED:",
            error.message
        );

        res.status(502).json({
            message: "Could not create quiz.",
            error: error.message
        });
    }
});

/* =========================
   DATABASE
========================= */

async function findUser(field, value) {

    const response = await axios.get(
        `${DB_BASE}?${field}=${encodeURIComponent(value)}`,
        {
            headers: dbHeaders()
        }
    );

    const records =
        response.data &&
        response.data.data;

    return records && records.length
        ? records[0]
        : null;
}

function publicProfile(user) {

    return {
        id: user._id,
        username: user.username,
        email: user.email,
        stars: user.stars || 0,
        characters: user.characters || [],
        ownedAt: user._createdAt
    };
}

app.post("/register", async (req, res) => {

    console.log("REGISTER REQUEST RECEIVED");

    const {
        username,
        email,
        password
    } = req.body;

    if (!username || !email || !password) {

        return res.status(400).json({
            message: "Please fill in all fields"
        });
    }

    try {

        const existing =
            await findUser(
                "username",
                username
            );

        if (existing) {

            return res.status(409).json({
                message: "Username already taken"
            });
        }

        const response =
            await axios.post(
                DB_BASE,
                {
                    email: email,
                    password: password,
                    username: username,
                    stars: 0,
                    characters: []
                },
                {
                    headers: dbHeaders()
                }
            );

        const created =
            response.data;

        res.status(201).json({
            message:
                "Account created successfully",

            profile:
                publicProfile(created)
        });

    } catch (error) {

        console.log("DATABASE ERROR");

        if (error.response) {

            console.log(
                "Status:",
                error.response.status
            );

            console.log(
                "Data:",
                error.response.data
            );

        } else {

            console.log(
                "Error:",
                error.message
            );
        }

        res.status(500).json({
            message: "Server error"
        });
    }
});

app.post("/login", async (req, res) => {

    console.log("LOGIN REQUEST RECEIVED");

    const {
        username,
        password
    } = req.body;

    if (!username || !password) {

        return res.status(400).json({
            message:
                "Please enter your username and password."
        });
    }

    try {

        const user =
            await findUser(
                "username",
                username
            );

        if (
            !user ||
            user.password !== password
        ) {

            return res.status(401).json({
                message:
                    "Incorrect username or password"
            });
        }

        res.status(200).json({
            message:
                "Login successful",

            profile:
                publicProfile(user)
        });

    } catch (error) {

        console.log("DATABASE ERROR");

        if (error.response) {

            console.log(
                "Status:",
                error.response.status
            );

            console.log(
                "Data:",
                error.response.data
            );

        } else {

            console.log(
                "Error:",
                error.message
            );
        }

        res.status(500).json({
            message: "Server error"
        });
    }
});

/* =========================
   PROFILE
========================= */

async function getUserById(id) {

    try {

        const response =
            await axios.get(
                `${DB_BASE}/${id}`,
                {
                    headers: dbHeaders()
                }
            );

        return response.data;

    } catch (error) {

        if (
            error.response &&
            error.response.status === 404
        ) {
            return null;
        }

        throw error;
    }
}

async function updateUser(id, fields) {

    const response =
        await axios.patch(
            `${DB_BASE}/${id}`,
            fields,
            {
                headers: dbHeaders()
            }
        );

    return response.data;
}

app.get("/profile/:id", async (req, res) => {

    try {

        const user =
            await getUserById(
                req.params.id
            );

        if (!user) {

            return res.status(404).json({
                message: "Profile not found"
            });
        }

        res.status(200).json({
            profile:
                publicProfile(user)
        });

    } catch (error) {

        console.log(
            "DATABASE ERROR",
            error.message
        );

        res.status(500).json({
            message: "Server error"
        });
    }
});

app.patch("/profile/:id", async (req, res) => {

    const {
        characterId
    } = req.body;

    try {

        const user =
            await getUserById(
                req.params.id
            );

        if (!user) {

            return res.status(404).json({
                message: "Profile not found"
            });
        }

        const characters =
            user.characters || [];

        if (
            characterId &&
            !characters.includes(characterId)
        ) {
            characters.push(characterId);
        }

        const updated =
            await updateUser(
                req.params.id,
                {
                    characters
                }
            );

        res.status(200).json({
            message:
                "Profile updated",

            profile:
                publicProfile(updated)
        });

    } catch (error) {

        console.log(
            "PATCH ERROR",
            error.message
        );

        res.status(500).json({
            message: "Server error"
        });
    }
});

app.post(
    "/profile/:id/awards",
    async (req, res) => {

        const {
            stars = 0,
            characterId
        } = req.body;

        try {

            const user =
                await getUserById(
                    req.params.id
                );

            if (!user) {

                return res.status(404).json({
                    message:
                        "Profile not found"
                });
            }

            const characters =
                user.characters || [];

            if (
                characterId &&
                !characters.includes(characterId)
            ) {
                characters.push(characterId);
            }

            const updated =
                await updateUser(
                    req.params.id,
                    {
                        stars:
                            (user.stars || 0) +
                            Number(stars),

                        characters
                    }
                );

            res.status(200).json({
                message:
                    "Reward applied",

                starsEarned:
                    Number(stars),

                profile:
                    publicProfile(updated)
            });

        } catch (error) {

            console.log(
                "AWARD ERROR",
                error.message
            );

            res.status(500).json({
                message: "Server error"
            });
        }
    }
);

/* =========================
   MATCHMAKING
========================= */

const rooms = [];

const ROOM_SIZE = 4;

function findPlayerRoom(id) {

    for (const room of rooms) {

        if (
            room.players.some(
                p => p.id === id
            )
        ) {
            return room;
        }
    }

    return null;
}

function findRoom(subject) {

    for (const room of rooms) {

        if (
            room.subject === subject &&
            room.status === "waiting" &&
            room.players.length < ROOM_SIZE
        ) {
            return room;
        }
    }

    return null;
}

function roomData(room) {

    return {

        id: room.id,

        subject: room.subject,

        size: room.size,

        status: room.status,

        quizStatus:
            room.quizStatus,

        currentQuestion:
            room.currentQuestion,
        countdownMs:
            room.status === "starting"
                ? Math.max(
                    0,
                    room.startAt - Date.now()
                )
                : null,

        count:
            room.players.length,

        players:
            room.players,

        quiz:
            room.quizStatus === "ready"
                ? room.quiz
                : null,

        quizError:
            room.quizStatus === "error"
                ? room.quizError
                : null
    };
}

async function generateRoomQuiz(room) {

    if (room.quizStatus === "creating") {

        console.log(
            "Quiz is already being created for:",
            room.id
        );

        return;
    }

    if (room.quizStatus === "ready") {

        console.log(
            "Quiz already exists for:",
            room.id
        );

        return;
    }

    room.quizStatus = "creating";

    console.log(
        "================================="
    );

    console.log(
        "CREATING MATCHMAKING QUIZ"
    );

    console.log(
        "ROOM:",
        room.id
    );

    console.log(
        "THIS WILL MAKE ONLY ONE AI REQUEST"
    );

    console.log(
        "================================="
    );

    try {

        console.log("ROOM SUBJECT BEFORE AI:", room.subject);
        console.log("ROOM ID:", room.id);
        console.log("GENERATING QUIZ FOR:", room.subject);

        const quiz =
            await createAIQuiz(
                room.subject,
                "Compete",
                10
            );

        room.quiz = quiz;

        room.quizStatus = "ready";

        room.quizError = null;

        room.status = "starting";

        room.startAt =
            Date.now() + 5000;

        console.log(
            "================================="
        );

        console.log(
            "MATCHMAKING QUIZ READY"
        );

        console.log(
            "ROOM:",
            room.id
        );

        console.log(
            "All players will receive the same quiz."
        );

        console.log(
            "================================="
        );

        setTimeout(function() {

            const index =
                rooms.indexOf(room);

            if (index !== -1) {

                rooms.splice(
                    index,
                    1
                );
            }

        }, 10 * 60 * 1000);

    } catch (error) {

        console.log(
            "MATCHMAKING QUIZ FAILED:",
            error.message
        );

        room.quizStatus = "error";

        room.quizError =
            error.message;

        room.status = "waiting";
    }
}

function checkRoomStart(room) {

    if (
        room.status !== "waiting"
    ) {
        return;
    }

    if (
        room.players.length === 0
    ) {
        return;
    }

    const everyoneReady =
        room.players.every(
            function(player) {
                return player.vote === true;
            }
        );

    if (!everyoneReady) {
        return;
    }

    if (
        room.quizStatus === "creating" ||
        room.quizStatus === "ready"
    ) {
        return;
    }

    generateRoomQuiz(room);
}

app.post(
    "/matchmaking/matchmake",
    async (req, res) => {

        const {
            id,
            name,
            character,
            subject
        } = req.body;

        if (
            !id ||
            !name ||
            !subject
        ) {

            return res.status(400).json({
                message:
                    "Missing matchmaking information"
            });
        }

        let room =
            findPlayerRoom(id);

        if (!room) {

            room =
                findRoom(subject);

            if (!room) {

                room = {
                
                    id:
                        "room_" +
                        Date.now() +
                        "_" +
                        Math.random()
                            .toString(36)
                            .slice(2),
                
                    subject:
                        subject,
                
                    size:
                        ROOM_SIZE,
                
                    status:
                        "waiting",
                
                    startAt:
                        null,
                
                    quizStatus:
                        "waiting",
                
                    quiz:
                        null,
                
                    quizError:
                        null,
                
                    currentQuestion:
                        0,
                
                    answers:
                        {},
                
                    players:
                        []
                };

                rooms.push(room);

                console.log(
                    "NEW ROOM:",
                    room.id
                );
            }

            room.players.push({

                id:
                    id,

                name:
                    name,

                character:
                    character,

                vote:
                    null
            });

        } else {

            const player =
                room.players.find(
                    function(p) {
                        return p.id === id;
                    }
                );

            if (player) {

                player.name =
                    name;

                player.character =
                    character;
            }
        }

        checkRoomStart(room);

        res.json(
            roomData(room)
        );
    }
);

app.post(
    "/matchmaking/vote",
    async (req, res) => {

        const {
            id,
            vote
        } = req.body;

        const room =
            findPlayerRoom(id);

        if (!room) {

            return res.status(404).json({
                message:
                    "Matchmaking room not found"
            });
        }

        const player =
            room.players.find(
                function(p) {
                    return p.id === id;
                }
            );

        if (!player) {

            return res.status(404).json({
                message:
                    "Player not found"
            });
        }

        if (
            room.status === "starting"
        ) {

            return res.json(
                roomData(room)
            );
        }

        if (
            room.quizStatus === "creating"
        ) {

            return res.json(
                roomData(room)
            );
        }

        player.vote =
            vote === true;

        checkRoomStart(room);

        res.json(
            roomData(room)
        );
    }
);

app.post(
    "/matchmaking/answer",
    async (req, res) => {

        const {
            id,
            answer
        } = req.body;

        const room =
            findPlayerRoom(id);

        if (!room) {

            return res.status(404).json({
                message:
                    "Matchmaking room not found"
            });
        }

        if (
            room.quizStatus !== "ready"
        ) {

            return res.status(400).json({
                message:
                    "Quiz is not ready"
            });
        }

        const player =
            room.players.find(
                function(p) {
                    return p.id === id;
                }
            );

        if (!player) {

            return res.status(404).json({
                message:
                    "Player not found"
            });
        }

        const questionIndex =
            room.currentQuestion;

        if (
            !room.answers[questionIndex]
        ) {
            room.answers[questionIndex] = {};
        }

        room.answers[questionIndex][id] = {
            answer: answer,
            answered: true
        };

        const answeredPlayers =
            Object.keys(
                room.answers[questionIndex]
            ).length;

        const totalPlayers =
            room.players.length;

        if (
            answeredPlayers >= totalPlayers
        ) {

            if (
                room.currentQuestion <
                room.quiz.questions.length - 1
            ) {

                room.currentQuestion++;

            } else {

                room.status =
                    "finished";
            }
        }

        res.json(
            roomData(room)
        );
    }
);

app.post(
    "/matchmaking/leave",
    (req, res) => {

        const {
            id
        } = req.body;

        const room =
            findPlayerRoom(id);

        if (!room) {

            return res.json({
                message:
                    "Player was not in a room"
            });
        }

        room.players =
            room.players.filter(
                function(player) {
                    return player.id !== id;
                }
            );

        if (
            room.players.length === 0
        ) {

            const index =
                rooms.indexOf(room);

            if (index !== -1) {

                rooms.splice(
                    index,
                    1
                );
            }
        }

        res.json({
            message:
                "Left matchmaking room"
        });
    }
);

/* =========================
   SERVER
========================= */

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `AI quiz endpoint: POST /quiz`
        );

        console.log(
            `Matchmaking endpoint: POST /matchmaking/matchmake`
        );
    }
);
