const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.get("/ping", (req, res) => {
  res.send("PING OK");
});


// MongoDB Connection
mongoose
  .connect("mongodb://127.0.0.1:27017/bloodbuddy")
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error(err));

// Routes
app.use("/api/hospitals", require("./routes/hospitalRoutes"));
app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api/requests", require("./routes/requestRoutes"));
app.use("/api/donors", require("./routes/donorRoutes"));
app.use("/api/match", require("./routes/matchRoutes"));

app.get("/", (req, res) => {
  res.send("Blood Buddy API Running");
});

app.listen(5050, () => {
  console.log("Server running on port 5050");
});

