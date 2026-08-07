const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Quizly backend is running!");
});

app.post("/register", async (req, res) => {
    console.log("REGISTER REQUEST RECEIVED");
    console.log(req.body);

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        console.log("Missing information");

        return res.status(400).json({
            message: "Please fill in all fields"
        });
    }

    try {
        console.log("Sending data to Quizly...");

        const response = await axios.post(
            "https://priornetwork.com/web/ranijumamil/db/quizly/users",
            {
                email: email,
                password: password,
                username: username
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": process.env.QUIZLY_RW_KEY
                }
            }
        );

        console.log("Quizly response:");
        console.log(response.status);
        console.log(response.data);

        res.status(201).json({
            message: "Account created successfully",
            data: response.data
        });

    } catch (error) {
        console.log("DATABASE ERROR");

        if (error.response) {
            console.log("Status:", error.response.status);
            console.log("Data:", error.response.data);
        } else {
            console.log("Error:", error.message);
        }

        res.status(500).json({
            message: "Server error"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});