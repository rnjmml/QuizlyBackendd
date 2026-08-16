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
/* =========================
   MATCHMAKING
========================= */

const rooms = [];

const ROOM_SIZE = 4;

/*
 * Matchmaking question timer.
 *
 * IMPORTANT:
 * This is controlled by the SERVER.
 * Players cannot individually move
 * to the next question.
 */
const MATCH_QUESTION_TIME_MS = 10 * 1000;


/* =========================
   ROOM HELPERS
========================= */

function findPlayerRoom(id) {

    for (const room of rooms) {

        if (
            room.players.some(
                function(player) {
                    return player.id === id;
                }
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


/* =========================
   ROOM DATA
========================= */

function roomData(room) {

    const now =
        Date.now();

    let questionTimeLeftMs =
        null;

    if (
        room.questionStartedAt !== null
    ) {

        questionTimeLeftMs =
            Math.max(
                0,
                MATCH_QUESTION_TIME_MS -
                (
                    now -
                    room.questionStartedAt
                )
            );
    }

    const currentQuestion =
        room.currentQuestion;

    const currentAnswers =
        room.answers[currentQuestion] ||
        {};

    const currentReady =
        room.questionReady[currentQuestion] ||
        {};

    return {

        id:
            room.id,

        subject:
            room.subject,

        size:
            room.size,

        status:
            room.status,

        quizStatus:
            room.quizStatus,

        currentQuestion:
            currentQuestion,

        countdownMs:
            room.status === "starting"
                ? Math.max(
                    0,
                    room.startAt - now
                )
                : null,

        /*
         * Server-authoritative question timer.
         */
        questionStartedAt:
            room.questionStartedAt,

        questionDurationMs:
            MATCH_QUESTION_TIME_MS,

        questionTimeLeftMs:
            questionTimeLeftMs,

        questionActive:
            room.status === "playing" &&
            room.questionStartedAt !== null &&
            questionTimeLeftMs > 0,

        /*
         * Number of players who have
         * answered the current question.
         */
        answeredCount:
            Object.keys(
                currentAnswers
            ).length,

        /*
         * Number of players who have
         * confirmed that they received
         * the current question.
         */
        readyCount:
            Object.keys(
                currentReady
            ).length,

        count:
            room.players.length,

        players:
            room.players,

        /*
         * Only expose the quiz once
         * it is ready.
         */
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


/* =========================
   QUESTION READY CHECK
========================= */

function areAllPlayersReady(room) {

    if (
        !room ||
        room.players.length === 0
    ) {
        return false;
    }

    const questionIndex =
        room.currentQuestion;

    const ready =
        room.questionReady[
            questionIndex
        ] || {};

    return room.players.every(
        function(player) {

            return (
                ready[player.id] === true
            );

        }
    );
}


/* =========================
   START QUESTION TIMER
========================= */

function startRoomQuestion(room) {

    if (!room) {
        return;
    }

    if (
        room.status === "finished"
    ) {
        return;
    }

    if (
        room.quizStatus !== "ready"
    ) {
        return;
    }

    /*
     * Do not start another timer
     * if this question is already active.
     */
    if (
        room.questionStartedAt !== null
    ) {
        return;
    }

    if (
        room.players.length === 0
    ) {
        return;
    }

    /*
     * The timer starts ONLY after
     * every player has received
     * the question.
     */
    if (
        !areAllPlayersReady(room)
    ) {
        return;
    }

    /*
     * Make sure the room is actually
     * in the playing state.
     */
    room.status =
        "playing";

    /*
     * This timestamp is the single
     * source of truth for the timer.
     */
    room.questionStartedAt =
        Date.now();

    console.log(
        "================================="
    );

    console.log(
        "MATCHMAKING QUESTION STARTED"
    );

    console.log(
        "ROOM:",
        room.id
    );

    console.log(
        "QUESTION:",
        room.currentQuestion + 1
    );

    console.log(
        "TIMER:",
        MATCH_QUESTION_TIME_MS / 1000,
        "seconds"
    );

    console.log(
        "================================="
    );

    /*
     * Server-side timer.
     *
     * This automatically advances
     * the room if not everyone answers.
     */
    room.questionTimer =
        setTimeout(
            function() {

                /*
                 * Room may have been deleted.
                 */
                if (
                    !rooms.includes(room)
                ) {
                    return;
                }

                /*
                 * Room may already have
                 * advanced because everyone
                 * answered.
                 */
                if (
                    room.status !== "playing"
                ) {
                    return;
                }

                /*
                 * Safety check.
                 */
                if (
                    room.questionStartedAt === null
                ) {
                    return;
                }

                console.log(
                    "MATCHMAKING TIMER EXPIRED:",
                    room.id,
                    "Question:",
                    room.currentQuestion + 1
                );

                advanceRoomQuestion(
                    room
                );

            },
            MATCH_QUESTION_TIME_MS + 50
        );
}


/* =========================
   ADVANCE QUESTION
========================= */

function advanceRoomQuestion(room) {

    if (!room) {
        return;
    }

    if (
        room.status === "finished"
    ) {
        return;
    }

    /*
     * Stop the old question timer.
     */
    if (
        room.questionTimer
    ) {

        clearTimeout(
            room.questionTimer
        );

        room.questionTimer =
            null;
    }

    /*
     * Stop the old question.
     */
    room.questionStartedAt =
        null;

    /*
     * Make sure the quiz exists.
     */
    if (
        !room.quiz ||
        !Array.isArray(
            room.quiz.questions
        )
    ) {
        room.status =
            "finished";

        return;
    }

    const lastQuestion =
        room.currentQuestion >=
        room.quiz.questions.length - 1;

    /*
     * FINAL QUESTION
     */
    if (
        lastQuestion
    ) {

        room.status =
            "finished";

        console.log(
            "================================="
        );

        console.log(
            "MATCHMAKING FINISHED"
        );

        console.log(
            "ROOM:",
            room.id
        );

        console.log(
            "================================="
        );

        return;
    }

    /*
     * Move everyone to the next
     * question together.
     */
    room.currentQuestion++;

    /*
     * New question starts with
     * nobody ready.
     */
    room.questionReady[
        room.currentQuestion
    ] = {};

    /*
     * The next question is waiting
     * for all players to receive it.
     */
    room.status =
        "waiting_question";

    console.log(
        "================================="
    );

    console.log(
        "MATCHMAKING NEXT QUESTION"
    );

    console.log(
        "ROOM:",
        room.id
    );

    console.log(
        "QUESTION:",
        room.currentQuestion + 1
    );

    console.log(
        "Waiting for all players..."
    );

    console.log(
        "================================="
    );
}


/* =========================
   GENERATE MATCH QUIZ
========================= */

async function generateRoomQuiz(room) {

    if (
        room.quizStatus === "creating"
    ) {

        console.log(
            "Quiz is already being created for:",
            room.id
        );

        return;
    }

    if (
        room.quizStatus === "ready"
    ) {

        console.log(
            "Quiz already exists for:",
            room.id
        );

        return;
    }

    room.quizStatus =
        "creating";

    room.status =
        "creating";

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

        console.log(
            "ROOM SUBJECT BEFORE AI:",
            room.subject
        );

        console.log(
            "ROOM ID:",
            room.id
        );

        console.log(
            "GENERATING QUIZ FOR:",
            room.subject
        );

        const quiz =
            await createAIQuiz(
                room.subject,
                "Compete",
                10
            );

        room.quiz =
            quiz;

        room.quizStatus =
            "ready";

        room.quizError =
            null;

        /*
         * Give the clients the existing
         * 5-second countdown before the
         * first question.
         */
        room.status =
            "starting";

        room.startAt =
            Date.now() + 5000;

        /*
         * Reset all question state.
         */
        room.currentQuestion =
            0;

        room.answers =
            {};

        room.questionReady =
            {
                0: {}
            };

        room.questionStartedAt =
            null;

        room.questionTimer =
            null;

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
            "First question will wait for all players."
        );

        console.log(
            "================================="
        );

        /*
         * Safety cleanup after 10 minutes.
         */
        setTimeout(
            function() {

                const index =
                    rooms.indexOf(room);

                if (
                    index !== -1
                ) {

                    /*
                     * Stop any active timer.
                     */
                    if (
                        room.questionTimer
                    ) {

                        clearTimeout(
                            room.questionTimer
                        );

                        room.questionTimer =
                            null;
                    }

                    rooms.splice(
                        index,
                        1
                    );
                }

            },
            10 * 60 * 1000
        );

    } catch (error) {

        console.log(
            "MATCHMAKING QUIZ FAILED:",
            error.message
        );

        room.quizStatus =
            "error";

        room.quizError =
            error.message;

        room.status =
            "waiting";
    }
}


/* =========================
   CHECK ROOM START
========================= */

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

                return (
                    player.vote === true
                );

            }
        );

    if (
        !everyoneReady
    ) {
        return;
    }

    if (
        room.quizStatus === "creating" ||
        room.quizStatus === "ready"
    ) {
        return;
    }

    generateRoomQuiz(
        room
    );
}


/* =========================
   JOIN / MATCHMAKE
========================= */

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

                    /*
                     * Answers are stored
                     * by question and player.
                     */
                    answers:
                        {},

                    /*
                     * Ready state is stored
                     * by question and player.
                     */
                    questionReady:
                        {},

                    /*
                     * Server timestamp for
                     * the active question.
                     */
                    questionStartedAt:
                        null,

                    /*
                     * Server timer handle.
                     */
                    questionTimer:
                        null,

                    players:
                        []
                };

                rooms.push(
                    room
                );

                console.log(
                    "NEW ROOM:",
                    room.id
                );
            }

            /*
             * Prevent duplicate players.
             */
            const existingPlayer =
                room.players.find(
                    function(player) {
                        return (
                            player.id === id
                        );
                    }
                );

            if (
                !existingPlayer
            ) {

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
            }

        } else {

            const player =
                room.players.find(
                    function(p) {
                        return p.id === id;
                    }
                );

            if (
                player
            ) {

                player.name =
                    name;

                player.character =
                    character;
            }
        }

        /*
         * If this is a newly joined player
         * during a waiting-for-question state,
         * make sure the ready object exists.
         */
        if (
            !room.questionReady[
                room.currentQuestion
            ]
        ) {

            room.questionReady[
                room.currentQuestion
            ] = {};
        }

        checkRoomStart(
            room
        );

        res.json(
            roomData(room)
        );
    }
);


/* =========================
   VOTE
========================= */

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

        /*
         * Once the quiz has started,
         * voting is locked.
         */
        if (
            room.status === "starting" ||
            room.status === "creating" ||
            room.status === "playing" ||
            room.status === "waiting_question"
        ) {

            return res.json(
                roomData(room)
            );
        }

        player.vote =
            vote === true;

        checkRoomStart(
            room
        );

        res.json(
            roomData(room)
        );
    }
);


/* =========================
   QUESTION READY
========================= */

/*
 * The frontend calls this after
 * the current question has actually
 * been rendered/received.
 *
 * The timer DOES NOT start until
 * every player has called this.
 */
app.post(
    "/matchmaking/question-ready",
    (req, res) => {

        const {
            id
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

        /*
         * During the initial 5-second
         * countdown, don't start the
         * question yet.
         */
        if (
            room.status === "starting"
        ) {

            if (
                Date.now() <
                room.startAt
            ) {

                return res.json(
                    roomData(room)
                );
            }

            room.status =
                "waiting_question";
        }

        /*
         * Only allow ready state for
         * an active/current question.
         */
        if (
            room.status !== "waiting_question" &&
            room.status !== "playing"
        ) {

            return res.json(
                roomData(room)
            );
        }

        const questionIndex =
            room.currentQuestion;

        if (
            !room.questionReady[
                questionIndex
            ]
        ) {

            room.questionReady[
                questionIndex
            ] = {};
        }

        /*
         * Mark this player as having
         * received the question.
         */
        room.questionReady[
            questionIndex
        ][id] =
            true;

        /*
         * If everyone has received it,
         * start the 10-second timer.
         */
        startRoomQuestion(
            room
        );

        res.json(
            roomData(room)
        );
    }
);


/* =========================
   ANSWER
========================= */

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

        /*
         * The question cannot be answered
         * until the server has started it.
         */
        if (
            room.status !== "playing" ||
            room.questionStartedAt === null
        ) {

            return res.status(409).json({

                message:
                    "Question is not active",

                room:
                    roomData(room)
            });
        }

        /*
         * Extra protection against a
         * late answer arriving just after
         * the 10-second timer.
         */
        if (
            Date.now() -
            room.questionStartedAt >=
            MATCH_QUESTION_TIME_MS
        ) {

            advanceRoomQuestion(
                room
            );

            return res.json(
                roomData(room)
            );
        }

        if (
            !room.answers[
                questionIndex
            ]
        ) {

            room.answers[
                questionIndex
            ] = {};
        }

        /*
         * IMPORTANT:
         *
         * One answer per player per
         * question.
         *
         * This also prevents a player
         * from changing their answer.
         */
        if (
            room.answers[
                questionIndex
            ][id]
        ) {

            return res.json(
                roomData(room)
            );
        }

        room.answers[
            questionIndex
        ][id] = {

            answer:
                answer,

            answered:
                true
        };

        const answeredPlayers =
            Object.keys(
                room.answers[
                    questionIndex
                ]
            ).length;

        const totalPlayers =
            room.players.length;

        console.log(
            "MATCH ANSWER:",
            room.id,
            "Question:",
            questionIndex + 1,
            "Answered:",
            answeredPlayers + "/" + totalPlayers
        );

        /*
         * If EVERYONE answered before
         * the timer expired, immediately
         * advance the whole room.
         */
        if (
            answeredPlayers >=
            totalPlayers
        ) {

            console.log(
                "ALL PLAYERS ANSWERED EARLY:",
                room.id
            );

            advanceRoomQuestion(
                room
            );
        }

        res.json(
            roomData(room)
        );
    }
);


/* =========================
   LEAVE ROOM
========================= */

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

        /*
         * Remove player.
         */
        room.players =
            room.players.filter(
                function(player) {

                    return (
                        player.id !== id
                    );

                }
            );

        /*
         * Remove their ready state
         * from the current question.
         */
        if (
            room.questionReady[
                room.currentQuestion
            ]
        ) {

            delete room.questionReady[
                room.currentQuestion
            ][id];
        }

        /*
         * If nobody remains,
         * completely remove the room.
         */
        if (
            room.players.length === 0
        ) {

            if (
                room.questionTimer
            ) {

                clearTimeout(
                    room.questionTimer
                );

                room.questionTimer =
                    null;
            }

            const index =
                rooms.indexOf(room);

            if (
                index !== -1
            ) {

                rooms.splice(
                    index,
                    1
                );
            }

            return res.json({
                message:
                    "Left matchmaking room"
            });
        }

        /*
         * If someone left while the
         * current question was waiting
         * for everyone to be ready,
         * re-check the condition.
         */
        if (
            room.status === "waiting_question"
        ) {

            startRoomQuestion(
                room
            );
        }

        /*
         * If someone left after the
         * question started, we should
         * check whether the remaining
         * players have all answered.
         */
        if (
            room.status === "playing"
        ) {

            const answers =
                room.answers[
                    room.currentQuestion
                ] || {};

            const answeredPlayers =
                Object.keys(
                    answers
                ).length;

            if (
                answeredPlayers >=
                room.players.length
            ) {

                advanceRoomQuestion(
                    room
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

        console.log(
            `Matchmaking question timer: ${
                MATCH_QUESTION_TIME_MS / 1000
            } seconds`
        );
    }
);
