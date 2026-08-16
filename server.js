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

/* =========================
   AI QUIZ
========================= */

function cleanAIResponse(content) {
    let cleaned = String(content || "").trim();

    cleaned = cleaned
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    return cleaned;
}

async function createAIQuiz(subject, mode, questionCount = 10) {
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
        subjectRules[subject] ||
        subjectRules.English;

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

Return ONLY valid JSON.

The JSON must have exactly this structure:

{
  "questions": [
    {
      "question": "Question text",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": "The exact correct option text",
      "explanation": "Short explanation of why the answer is correct"
    }
  ]
}

Rules:
- Create exactly ${count} questions.
- Every question must have exactly 4 options.
- Only one option may be correct.
- The answer must exactly match one of the four options.
- Do not use "All of the above".
- Do not use "None of the above".
- Do not repeat questions.
- Keep questions appropriate for students.
- Keep explanations short and easy to understand.
- Do not include markdown.
- Do not include code fences.
- Do not include anything outside the JSON object.
`;

    console.log("=================================");
    console.log("CREATING AI QUIZ");
    console.log("Subject:", subject);
    console.log("Mode:", mode);
    console.log("Questions:", count);
    console.log("Model:", AI_MODEL);
    console.log("=================================");

    const response = await axios.post(
        OPENROUTER_URL,
        {
            model: AI_MODEL,

            messages: [
                {
                    role: "system",
                    content:
                        "You create accurate educational multiple-choice quizzes. Return valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],

            temperature: 0.4,
            max_tokens: 5000
        },
        {
            headers: {
                "Content-Type": "application/json",
                "Authorization":
                    `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer":
                    "https://quizlybackendd.onrender.com",
                "X-Title": "QuiZly"
            },

            timeout: 120000
        }
    );

    const content =
        response.data?.choices?.[0]?.message?.content;

    console.log("AI RESPONSE RECEIVED");

    if (!content) {
        console.log(response.data);

        throw new Error(
            "The AI did not return any content."
        );
    }

    console.log("RAW AI CONTENT:");
    console.log(content);

    const cleaned = cleanAIResponse(content);

    let quiz;

    try {
        quiz = JSON.parse(cleaned);
    } catch (error) {
        console.log("JSON PARSE ERROR");
        console.log("CLEANED RESPONSE:");
        console.log(cleaned);

        throw new Error(
            "The AI returned an invalid quiz format."
        );
    }

    if (
        !quiz ||
        !quiz.questions ||
        !Array.isArray(quiz.questions)
    ) {
        throw new Error(
            "The AI response does not contain questions."
        );
    }

    const questions = quiz.questions
        .filter(function(q) {
            if (
                !q ||
                typeof q.question !== "string" ||
                !Array.isArray(q.options) ||
                q.options.length !== 4 ||
                typeof q.answer !== "string"
            ) {
                return false;
            }

            const answer =
                q.answer.trim().toLowerCase();

            const validAnswer =
                q.options.some(function(option) {
                    return (
                        String(option)
                            .trim()
                            .toLowerCase() === answer
                    );
                });

            return validAnswer;
        })
        .slice(0, count)
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

    if (questions.length < count) {
        throw new Error(
            `The AI only created ${questions.length} valid questions out of ${count}.`
        );
    }

    console.log(
        `AI QUIZ CREATED: ${questions.length} QUESTIONS`
    );

    return {
        subject: subject,
        mode: mode,
        questions: questions
    };
}


/* =========================
   TEST AI
========================= */

app.get("/test-ai", async (req, res) => {
    try {
        console.log("TESTING OPENROUTER");

        const quiz = await createAIQuiz(
            "English",
            "Study",
            5
        );

        res.json({
            success: true,
            quiz: quiz
        });

    } catch (error) {
        console.log("OPENROUTER TEST FAILED");

        if (error.response) {
            console.log(
                "STATUS:",
                error.response.status
            );

            console.log(
                "DATA:",
                JSON.stringify(
                    error.response.data,
                    null,
                    2
                )
            );

            return res.status(502).json({
                success: false,
                status: error.response.status,
                error: error.response.data
            });
        }

        console.log(
            "ERROR:",
            error.message
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


/* =========================
   NORMAL AI QUIZ
========================= */

app.post("/quiz", async (req, res) => {
    console.log("QUIZ REQUEST RECEIVED");
    console.log(req.body);

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
        console.log("AI QUIZ ERROR");

        if (error.response) {
            console.log(
                "OPENROUTER STATUS:",
                error.response.status
            );

            console.log(
                "OPENROUTER DATA:",
                JSON.stringify(
                    error.response.data,
                    null,
                    2
                )
            );

            return res.status(502).json({
                message:
                    "OpenRouter request failed.",
                status:
                    error.response.status,
                error:
                    error.response.data
            });
        }

        console.log(
            "ERROR:",
            error.message
        );

        return res.status(502).json({
            message:
                "Could not create quiz.",
            error:
                error.message
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


/* =========================
   REGISTER
========================= */

app.post("/register", async (req, res) => {
    console.log(
        "REGISTER REQUEST RECEIVED"
    );

    console.log(req.body);

    const {
        username,
        email,
        password
    } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({
            message:
                "Please fill in all fields"
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
                message:
                    "Username already taken"
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
        console.log(
            "DATABASE ERROR"
        );

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
            message:
                "Server error"
        });
    }
});


/* =========================
   LOGIN
========================= */

app.post("/login", async (req, res) => {
    console.log(
        "LOGIN REQUEST RECEIVED"
    );

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
        console.log(
            "DATABASE ERROR"
        );

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
            message:
                "Server error"
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
                    headers:
                        dbHeaders()
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
                headers:
                    dbHeaders()
            }
        );

    return response.data;
}


app.get(
    "/profile/:id",
    async (req, res) => {
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
                message:
                    "Server error"
            });
        }
    }
);


app.patch(
    "/profile/:id",
    async (req, res) => {
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
                    message:
                        "Profile not found"
                });
            }

            const characters =
                user.characters || [];

            if (
                characterId &&
                !characters.includes(
                    characterId
                )
            ) {
                characters.push(
                    characterId
                );
            }

            const updated =
                await updateUser(
                    req.params.id,
                    {
                        characters:
                            characters
                    }
                );

            res.status(200).json({
                message:
                    "Profile updated",

                profile:
                    publicProfile(
                        updated
                    )
            });

        } catch (error) {
            console.log(
                "PATCH ERROR",
                error.message
            );

            res.status(500).json({
                message:
                    "Server error"
            });
        }
    }
);


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
                !characters.includes(
                    characterId
                )
            ) {
                characters.push(
                    characterId
                );
            }

            const updated =
                await updateUser(
                    req.params.id,
                    {
                        stars:
                            (user.stars || 0) +
                            stars,

                        characters:
                            characters
                    }
                );

            res.status(200).json({
                message:
                    "Reward applied",

                starsEarned:
                    stars,

                profile:
                    publicProfile(
                        updated
                    )
            });

        } catch (error) {
            console.log(
                "AWARD ERROR",
                error.message
            );

            res.status(500).json({
                message:
                    "Server error"
            });
        }
    }
);


/* =========================
   MATCHMAKING
========================= */

const rooms = [];

const ROOM_SIZE = 4;


/*
   IMPORTANT

   Questions are stored inside the room.

   Therefore:

   Player 1
          |
   Player 2
          |
   Player 3
          |
   Player 4
          |
          v
   ONE OpenRouter request
          |
          v
   room.questions
          |
      +---+---+---+
      |   |   |   |
     P1  P2  P3  P4

   Every player gets the SAME questions.
*/


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
            (
                room.status === "waiting" ||
                room.status === "generating"
            ) &&
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

        subject:
            room.subject,

        size:
            room.size,

        status:
            room.status,

        countdownMs:
            room.status === "starting"
                ? Math.max(
                    0,
                    room.startAt -
                    Date.now()
                )
                : null,

        count:
            room.players.length,

        players:
            room.players,

        quizReady:
            Array.isArray(
                room.questions
            ),

        questions:
            Array.isArray(
                room.questions
            )
                ? room.questions
                : null
    };
}


/*
   This function generates the quiz.

   It is protected by room.generating.

   This prevents multiple users from
   accidentally causing multiple AI requests.
*/

async function generateRoomQuiz(room) {

    if (room.questions) {
        console.log(
            "QUIZ ALREADY EXISTS FOR ROOM:",
            room.id
        );

        return;
    }

    if (room.generating) {
        console.log(
            "QUIZ ALREADY BEING GENERATED:",
            room.id
        );

        return room.generating;
    }

    console.log(
        "================================="
    );

    console.log(
        "GENERATING MATCHMAKING QUIZ"
    );

    console.log(
        "ROOM:",
        room.id
    );

    console.log(
        "SUBJECT:",
        room.subject
    );

    console.log(
        "================================="
    );


    room.status =
        "generating";


    room.generating =
        createAIQuiz(
            room.subject,
            "Compete",
            10
        )
        .then(function(quiz) {

            room.questions =
                quiz.questions;

            room.status =
                "starting";

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
                "QUESTIONS:",
                room.questions.length
            );

            console.log(
                "================================="
            );

            setTimeout(
                function() {

                    if (
                        rooms.includes(
                            room
                        )
                    ) {
                        room.status =
                            "playing";

                        console.log(
                            "ROOM NOW PLAYING:",
                            room.id
                        );
                    }

                },
                5000
            );

            return quiz;

        })
        .catch(function(error) {

            console.log(
                "MATCHMAKING AI ERROR"
            );

            console.log(
                error.message
            );

            room.status =
                "waiting";

            room.questions =
                null;

            throw error;

        })
        .finally(function() {

            room.generating =
                null;

        });


    return room.generating;
}


/* =========================
   MATCHMAKE
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

                    players:
                        [],

                    questions:
                        null,

                    generating:
                        null
                };

                rooms.push(room);

                console.log(
                    "NEW ROOM CREATED:",
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


            console.log(
                "PLAYER JOINED ROOM:",
                id,
                room.id
            );

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


        res.json(
            roomData(room)
        );
    }
);


/* =========================
   VOTE / READY
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


        if (
            room.status ===
            "starting" ||
            room.status ===
            "generating" ||
            room.status ===
            "playing"
        ) {
            return res.json(
                roomData(room)
            );
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


        player.vote =
            vote === true;


        console.log(
            "PLAYER READY:",
            id
        );


        const everyoneReady =
            room.players.length > 0 &&
            room.players.every(
                function(player) {
                    return player.vote === true;
                }
            );


        /*
           IMPORTANT:

           We do NOT generate the quiz
           when the first player presses ready.

           We only generate when everyone
           in the room is ready.
        */

        if (
            everyoneReady &&
            room.players.length >= 2 &&
            !room.questions &&
            !room.generating
        ) {

            console.log(
                "EVERYONE READY"
            );

            console.log(
                "STARTING ONE AI REQUEST"
            );


            /*
               Do not await this before
               returning the response.

               The frontend can poll the
               matchmaking endpoint while
               the AI is creating the quiz.
            */

            generateRoomQuiz(room)
                .catch(function(error) {
                    console.log(
                        "ROOM QUIZ GENERATION FAILED:",
                        error.message
                    );
                });
        }


        res.json(
            roomData(room)
        );
    }
);


/* =========================
   GET MATCHMAKING ROOM
========================= */

app.get(
    "/matchmaking/room/:id",
    function(req, res) {

        const room =
            findPlayerRoom(
                req.params.id
            );


        if (!room) {
            return res.status(404).json({
                message:
                    "Matchmaking room not found"
            });
        }


        res.json(
            roomData(room)
        );
    }
);


/* =========================
   GET MATCHMAKING QUIZ
========================= */

app.get(
    "/matchmaking/quiz/:id",
    function(req, res) {

        const room =
            findPlayerRoom(
                req.params.id
            );


        if (!room) {
            return res.status(404).json({
                message:
                    "Matchmaking room not found"
            });
        }


        if (
            !room.questions
        ) {

            return res.status(202).json({
                message:
                    "Quiz is still being created.",

                status:
                    room.status,

                quizReady:
                    false
            });
        }


        res.json({

            subject:
                room.subject,

            mode:
                "Compete",

            questions:
                room.questions
        });
    }
);


/* =========================
   LEAVE MATCHMAKING
========================= */

app.post(
    "/matchmaking/leave",
    function(req, res) {

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


        console.log(
            "PLAYER LEFT ROOM:",
            id
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


            console.log(
                "ROOM DELETED:",
                room.id
            );
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
    function() {

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `AI quiz endpoint: POST /quiz`
        );

        console.log(
            `Matchmaking quiz endpoint: GET /matchmaking/quiz/:id`
        );
    }
);
