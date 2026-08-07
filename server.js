const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const DB_BASE = "https://priornetwork.com/web/ranijumamil/db/quizly/users";

function dbHeaders() {
    return {
        "Content-Type": "application/json",
        "x-api-key": process.env.QUIZLY_RW_KEY
    };
}

app.get("/", (req, res) => {
    res.send("Quizly backend is running!");
});

/**
 * Find a user by a field value and return the full record, or null.
 */
async function findUser(field, value) {
    const response = await axios.get(`${DB_BASE}?${field}=${encodeURIComponent(value)}`, {
        headers: dbHeaders()
    });
    const records = response.data && response.data.data;
    return records && records.length ? records[0] : null;
}

/**
 * Public profile (never exposes password).
 */
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
    console.log(req.body);

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        console.log("Missing information");
        return res.status(400).json({ message: "Please fill in all fields" });
    }

    try {
        const existing = await findUser("username", username);
        if (existing) {
            return res.status(409).json({ message: "Username already taken" });
        }

        console.log("Sending data to Quizly...");

        const response = await axios.post(
            DB_BASE,
            {
                email: email,
                password: password,
                username: username,
                stars: 0,
                characters: []
            },
            { headers: dbHeaders() }
        );

        console.log("Quizly response:");
        console.log(response.status);
        console.log(response.data);

        const created = response.data;
        res.status(201).json({
            message: "Account created successfully",
            profile: publicProfile(created)
        });

    } catch (error) {
        console.log("DATABASE ERROR");
        if (error.response) {
            console.log("Status:", error.response.status);
            console.log("Data:", error.response.data);
        } else {
            console.log("Error:", error.message);
        }
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/login", async (req, res) => {
    console.log("LOGIN REQUEST RECEIVED");

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Please enter your username and password." });
    }

    try {
        const user = await findUser("username", username);

        if (!user || user.password !== password) {
            return res.status(401).json({ message: "Incorrect username or password" });
        }

        res.status(200).json({
            message: "Login successful",
            profile: publicProfile(user)
        });

    } catch (error) {
        console.log("DATABASE ERROR");
        if (error.response) {
            console.log("Status:", error.response.status);
            console.log("Data:", error.response.data);
        } else {
            console.log("Error:", error.message);
        }
        res.status(500).json({ message: "Server error" });
    }
});

/**
 * Get a full record from the DB by its _id, or null.
 */
async function getUserById(id) {
    try {
        const response = await axios.get(`${DB_BASE}/${id}`, { headers: dbHeaders() });
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) return null;
        throw error;
    }
}

/**
 * PATCH a single record's fields by _id and return the updated record.
 */
async function updateUser(id, fields) {
    const response = await axios.patch(`${DB_BASE}/${id}`, fields, { headers: dbHeaders() });
    return response.data;
}

app.get("/profile/:id", async (req, res) => {
    try {
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ message: "Profile not found" });
        res.status(200).json({ profile: publicProfile(user) });
    } catch (error) {
        console.log("DATABASE ERROR", error.message);
        res.status(500).json({ message: "Server error" });
    }
});

app.patch("/profile/:id", async (req, res) => {
    const { characterId } = req.body;

    try {
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ message: "Profile not found" });

        const characters = user.characters || [];
        if (characterId && !characters.includes(characterId)) {
            characters.push(characterId);
        }

        const updated = await updateUser(req.params.id, { characters });

        res.status(200).json({
            message: "Profile updated",
            profile: publicProfile(updated)
        });
    } catch (error) {
        console.log("PATCH ERROR", error.message);
        res.status(500).json({ message: "Server error" });
    }
});

app.post("/profile/:id/awards", async (req, res) => {
    const { stars = 0, characterId } = req.body;

    try {
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ message: "Profile not found" });

        const characters = user.characters || [];
        if (characterId && !characters.includes(characterId)) {
            characters.push(characterId);
        }

        const updated = await updateUser(req.params.id, {
            stars: (user.stars || 0) + stars,
            characters
        });

        res.status(200).json({
            message: "Reward applied",
            starsEarned: stars,
            profile: publicProfile(updated)
        });
    } catch (error) {
        console.log("AWARD ERROR", error.message);
        res.status(500).json({ message: "Server error" });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
