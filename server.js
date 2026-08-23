const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const DB_BASE = "https://priornetwork.com/web/ranijumamil/db/quizly/users";

const PRIOR_URL = "https://priornetwork.com/prior/api/generate";
const AI_MODEL = "prior-standard";

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
        ai: !!process.env.PRIOR_API_KEY
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
        const parsed = JSON.parse(text);

        if (Array.isArray(parsed)) {
            return { questions: parsed};
        }

        return parsed;
        
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

            if (
                typeof q.answer !== "string" &&
                typeof q.correct !== "string"
            ) {
                return false;
            }

            const answer = (
                typeof q.answer === "string"
                    ? q.answer
                    : q.correct
            ).trim().toLowerCase();
            
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

                answer: (
                    typeof q.answer === "string"
                        ? q.answer
                        : q.correct
                ).trim(),

                explanation: (function(exp){
                    if(!exp) return "";
                    exp = String(exp).trim().replace(/\s+/g, " ");
                    var sentences = exp.match(/[^.!?]+[.!?]+/g);
                    if(sentences){
                        if(sentences.length > 2) sentences = sentences.slice(0,2);
                        exp = sentences.join(" ").trim();
                    }
                    if(exp.length > 160){
                        exp = exp.slice(0,157).trim();
                        var lastSpace = exp.lastIndexOf(" ");
                        if(lastSpace > 100) exp = exp.slice(0, lastSpace);
                        exp += "...";
                    }
                    if(exp && !/[.!?]$/.test(exp)) exp += ".";
                    return exp;
                })(q.explanation)
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
    
    if (!process.env.PRIOR_API_KEY) {
        throw new Error("PRIOR_API_KEY is missing");
    }

    const count = Math.min(
        Math.max(Number(questionCount) || 30, 1),
        30
    );

    const subjectRules = {
        English:
            "English language, grammar, vocabulary, reading comprehension, and basic literature",

        Math:
            "mathematics appropriate for students, including basic math problems like addition, subtraction, multiplication, division, and problem solving",

        Science:
            "general science, Earth science, and basic scientific concepts"
    };

    const topic =
        subjectRules[subject] || subjectRules.English;

    const audience =
        "children between 8 and 10 years old";

    const isThreeRound = count === 30;

    const difficulty = isThreeRound
        ? "progressive across 3 rounds for kids aged 8-10: Round 1 Easy for 8-10, Round 2 Intermediate for 8-10, Round 3 Hard for 8-10 (hardest still within 8-10 reading level)"
        : mode === "Compete"
            ? "easy to moderate difficulty for kids aged 8-10"
            : "beginner to moderate difficulty for kids aged 8-10";

    const roundBlock = isThreeRound
        ? `
ROUND STRUCTURE (must follow exactly, in this order, all for kids aged 8-10):
- Questions 1-10: EASY for 8-10 year olds (simple recall, basic vocabulary, single-step, very clear wording)
- Questions 11-20: INTERMEDIATE for 8-10 year olds (application, two-step reasoning, slightly longer stems)
- Questions 21-30: HARD for 8-10 year olds (analysis/inference, harder vocabulary still within 8-10 reading level, multi-step reasoning)
Keep the array in that exact order so Round 1 is easy, Round 2 intermediate, Round 3 hard. Even the HARD round must remain solvable by a strong 10-year-old — do not use adult, high-school, or professional content.
`
        : "";

    const prompt = `
Create a quiz for the educational game QuiZly.

Subject: ${subject}
Mode: ${mode}
Number of questions: ${count}
Difficulty: ${difficulty}
Audience: ${audience}

The questions must focus on:
${topic}
${roundBlock}
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
- Use simple, clear language an 8 to 10 year old can understand.
- Use age-appropriate topics, examples, and scenarios for 8-10 year olds.
- Keep explanations to 1-2 short sentences max (≤25 words), directly explaining why the answer is correct — no long stories.
- Do not add any text outside the JSON response.
 `;

    console.log("=================================");
    console.log("CREATING AI QUIZ");
    console.log("Model:", AI_MODEL);
    console.log("Subject:", subject);
    console.log("Mode:", mode);
    console.log("Questions:", count);
    console.log("=================================");

    if (isThreeRound) {
        console.log("THREE-ROUND MODE: 3x10 batches for 8-10");

        async function fetchBatch(diffLabel, diffDesc) {
            const batchPrompt = `
Create a quiz for the educational game QuiZly.

Subject: ${subject}
Mode: ${mode} (${diffLabel})
Number of questions: 10
Difficulty: ${diffDesc}
Audience: ${audience}

The questions must focus on:
${topic}

Create exactly 10 multiple-choice questions at ${diffDesc}.

Every question must have:
- exactly 4 options
- exactly 1 correct answer
- an answer that exactly matches one of the options
- a short explanation

Rules:
- Do not repeat questions.
- Do not use "All of the above".
- Do not use "None of the above".
- Keep the questions appropriate for students aged 8-10.
- Use simple, clear language an 8 to 10 year old can understand.
- Use age-appropriate topics, examples, and scenarios for 8-10 year olds.
- Keep explanations to 1-2 short sentences max (≤25 words), directly explaining why the answer is correct — no long stories.
- Do not add any text outside the JSON response.
 `;

            const maxAttempts = 3;
            let lastErr = null;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const resp = await axios.post(
                        PRIOR_URL,
                        {
                            model: AI_MODEL,
                            prompt:
                                "You create accurate educational multiple-choice quizzes for kids aged 8-10. " +
                                "Return ONLY a JSON object with a single key \"questions\" " +
                                "whose value is an array of question objects. " +
                                "Each question object must use exactly these keys: " +
                                "\"question\" (string), \"options\" (array of 4 strings), " +
                                "\"answer\" (string that exactly matches one of the options), " +
                    "and \"explanation\" (1-2 short sentences, max 25 words).\n\n" +
                        batchPrompt
                        },
                        {
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${process.env.PRIOR_API_KEY}`
                            },
                            timeout: 120000
                        }
                    );

                    let content = resp.data?.response;
                    if (content == null) throw new Error("Prior did not return a response for " + diffLabel);
                    if (Array.isArray(content)) {
                        content = content.filter(function(item){return item && item.type === "text";}).map(function(item){return item.text || "";}).join("");
                    }
                    content = String(content);
                    const quiz = extractJson(content);
                    if (!quiz) {
                        console.log("INVALID AI JSON for " + diffLabel);
                        console.log(content);
                        throw new Error("The AI returned an invalid quiz format for " + diffLabel);
                    }
                    const qs = validateQuiz(quiz, 10);
                    if (!qs) {
                        console.log("VALIDATION FAILED for " + diffLabel);
                        console.log(JSON.stringify(quiz,null,2));
                        throw new Error("The AI did not return 10 valid questions for " + diffLabel);
                    }
                    console.log(diffLabel + " batch ready: " + qs.length + (attempt > 1 ? " (attempt " + attempt + ")" : ""));
                    return qs;
                } catch (err) {
                    lastErr = err;
                    const isTimeout = err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'));
                    const isPrior500 = err.response && err.response.status >= 500;
                    const isValidation = err.message && (err.message.includes('did not return 10 valid') || err.message.includes('invalid quiz format'));
                    const shouldRetry = isTimeout || isPrior500 || isValidation;
                    console.log(diffLabel + " attempt " + attempt + " failed: " + err.message + (shouldRetry && attempt < maxAttempts ? " — retrying..." : ""));
                    if (!shouldRetry || attempt === maxAttempts) throw err;
                    await new Promise(function(r){ setTimeout(r, 2500 * attempt); });
                }
            }
            throw lastErr;
        }

        try {
            const [easyQs, medQs, hardQs] = await Promise.all([
                fetchBatch("EASY", "EASY for kids aged 8-10 (simple recall, basic vocabulary, single-step)"),
                fetchBatch("INTERMEDIATE", "INTERMEDIATE for kids aged 8-10 (application, two-step reasoning)"),
                fetchBatch("HARD", "HARD for kids aged 8-10 (analysis/inference, multi-step, still within 8-10 reading level)")
            ]);

            const allQuestions = [...easyQs, ...medQs, ...hardQs];
            console.log(`AI quiz successfully created with ${allQuestions.length} questions (10+10+10).`);
            return {
                subject: subject,
                mode: mode,
                questions: allQuestions
            };
        } catch (error) {
            console.log("=================================");
            console.log("AI QUIZ BATCH ERROR");
            console.log("=================================");
            if (error.response) {
                console.log("Prior status:", error.response.status);
                console.log(JSON.stringify(error.response.data,null,2));
                throw new Error(error.response.data?.error?.message || error.response.data?.message || "Prior request failed.");
            }
            console.log("Error:", error.message);
            if (error.stack) console.log("Error stack:", error.stack);
            throw error;
        }
    }

    try {

        const response = await axios.post(
            PRIOR_URL,
            {
                model: AI_MODEL,
                prompt:
                    "You create accurate educational multiple-choice quizzes for kids aged 8-10. " +
                    (isThreeRound ? "Calibrate Easy, Intermediate, and Hard all within the 8-10 band — even Hard must be solvable by a strong 10-year-old. " : "") +
                    "Return ONLY a JSON object with a single key \"questions\" " +
                    "whose value is an array of question objects. " +
                    "Each question object must use exactly these keys: " +
                    "\"question\" (string), \"options\" (array of 4 strings), " +
                    "\"answer\" (string that exactly matches one of the options), " +
                    "and \"explanation\" (1-2 short sentences, max 25 words).\n\n" +
                    prompt
             
            },
            {
                headers: {
                    "Content-Type": "application/json",

                    "Authorization":
                        `Bearer ${process.env.PRIOR_API_KEY}`,
                },

                timeout: isThreeRound ? 180000 : 120000
            }
        );

        console.log("Prior status:", response.status);
        console.log("Prior model:", response.data?.model);

        let content = response.data?.response;
        
        if (content == null) {
            throw new Error(
                "Prior did not return a response."
            );
        }
        
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

        content = String(content);
        
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

            console.log(
                "RAW AI RESPONSE",
                content
            );

            console.log(
                "PARSED QUIZ:",
                JSON.stringify(
                    quiz,
                    null,
                    2
                )
            );
            
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
                "Prior status:",
                error.response.status
            );

            console.log(
                "Prior response:"
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
                "Prior request failed."
            );
        }

        console.log(
            "Error:",
            error.message
        );

        if (error.stack) {
           console.log(
               "Error stack:",
               error.stack
           );
        }

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
        questionCount = 30
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

const QUESTION_TIME = 10000;

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

    let best = null;
    
    for (const room of rooms) {

        if (
            room.subject === subject &&
            room.status !== "active" &&
            room.status !== "finished" &&
            room.players.length < ROOM_SIZE
        ) {
            if (
                !best || 
                room.players.length >
                    best.players.length
            ) {
                best = room;
            } 
        }
    }

    return best;
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

        questionStartAt:
            room.questionStartAt,
        timeLeft:
            room.status === "active" &&
            room.quizStatus === "ready" &&
            room.questionStartAt
                ? Math.max(
                    0,
                    room.questionStartAt +
                        QUESTION_TIME -
                        Date.now()
                )
                : null,

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
    room.status = "creating";

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
                30
            );

        room.quiz = quiz;

        room.quizStatus = "ready";

        room.quizError = null;

        room.status = "starting";

        room.startAt =
            Date.now() + 5000;

        room.currentQuestion = 0;

        room.questionStartAt =
            room.startAt;

        armQuestionTimer(
            room,
            room.startAt + QUESTION_TIME
        );

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

        room.quizRetyAt = 
            Date.now();
        
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

    if (room.quizStatus === "creating" || room.quizStatus === "ready") {
        return;
    }
    
    if (
        room.quizRetryAt &&
        Date.now() < room.quizRetryAt + 8000
    ) {
        return;
    }

    generateRoomQuiz(room);
}

/* =====================================
   ROOM QUESTION TIMING / ADVANCE
   A room only moves forward when either:
   - the 10s question timer expires, or
   - every player in the room has answered.
===================================== */

function clearRoomQuestionTimer(room) {
    if (room.questionTimer) {
        clearTimeout(room.questionTimer);
        room.questionTimer = null;
    }
}

function armQuestionTimer(room, at) {
    clearRoomQuestionTimer(room);

    const when =
        at != null
            ? at
            : room.questionStartAt + QUESTION_TIME;

    const delay =
        Math.max(
            0,
            when - Date.now()
        );

    room.questionTimer =
        setTimeout(
            function() {
                checkQuestionTimer(room);
            },
            delay + 50
        );
}

function setQuestionActive(room) {
    room.questionStartAt = Date.now();
    armQuestionTimer(room);
}

function activateQuiz(room) {

    if (room.status !== "starting") {
        return;
    }

    if (
        !room.startAt ||
        Date.now() < room.startAt
    ) {
        return;
    }

    room.status = "active";

    console.log(
        "ROOM ACTIVE:",
        room.id
    );

    armQuestionTimer(
        room,
        room.questionStartAt + QUESTION_TIME
    );
}

function checkQuestionTimer(room) {

    if (room.status === "finished") {
        return;
    }

    if (room.quizStatus !== "ready") {
        return;
    }

    activateQuiz(room);

    if (room.status !== "active") {
        return;
    }

    if (!room.questionStartAt) {
        return;
    }

    if (
        Date.now() >=
        room.questionStartAt + QUESTION_TIME
    ) {

        advanceRoom(room);
    }
}

function advanceRoom(room) {

    if (room.status === "finished") {
        return;
    }

    if (room.quizStatus !== "ready") {
        return;
    }

    const questions =
        room.quiz.questions;

    const last =
        questions.length - 1;

    if (room.currentQuestion >= last) {

        room.status = "finished";

        clearRoomQuestionTimer(room);

        console.log(
            "ROOM FINISHED:",
            room.id
        );

        return;
    }

    room.currentQuestion++;

    room.status = "active";

    console.log(
        "ROOM ADVANCED:",
        room.id,
        "question",
        room.currentQuestion,
        "of",
        room.quiz.questions.length
    );

    setQuestionActive(room);
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

                    questionStartAt:
                        null,

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

        if (
   room.status === "waiting" &&
   room.players.length < ROOM_SIZE
) {


   const better =
       findRoom(subject);


   if (
       better &&
       better.id !== room.id &&
       better.players.length >
           room.players.length
   ) {


       const player =
           room.players.find(
               function(p) {
                   return p.id === id;
               }
           );


       if (player) {


           room.players =
               room.players.filter(
                   function(p) {
                       return p.id !== id;
                   }
               );


           if (room.players.length === 0) {


               const index =
                   rooms.indexOf(room);


               if (index !== -1) {


                   rooms.splice(
                       index,
                       1
                   );
               }
           }


           player.vote = null;


           better.players.push(player);


           room = better;

           if (
               room.quizStatus === "creating" ||
               room.quizStatus === "ready"
            ) {

               console.log(
                   "MERGED PLAYER INTO ACTIVE GENERATION",
                   room.id
               );
           }
           
           console.log(
               "PLAYER MOVED TO FULLER ROOM:",
               room.id,

               "status",
               room.status,

               "quizStatus",
               room.quizStatus
            );

       }
   }
}
        
        checkRoomStart(room);

        checkQuestionTimer(room);

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

        if (
            room.status === "finished"
        ) {

            return res.status(400).json({
                message:
                    "Quiz is already finished"
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

        checkQuestionTimer(room);

        if (room.status !== "active") {

            return res.json(
                roomData(room)
            );
        }

        const questionIndex =
            room.currentQuestion;

        if (
            !room.answers[questionIndex]
        ) {
            room.answers[questionIndex] = {};
        }

        if (
            room.answers[questionIndex][id]
        ) {

            return res.json(
                roomData(room)
            );
        }

        room.answers[questionIndex][id] = {
            answer: answer,
            answered: true
        };

        const answeredPlayers =
            Object.keys(
                room.answers[questionIndex]
            ).length;

        if (
            answeredPlayers >=
            room.players.length
        ) {

            advanceRoom(room);
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
