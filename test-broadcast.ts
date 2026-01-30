import * as broadcast from "./src/db/broadcast";
import { close } from "./src/db/client";

async function test() {
  try {
    console.log("Creating webhook...");
    const webhook = await broadcast.createWebhook({
      appName: "localtest4",
      title: "Local Test 4",
      owner: "domingo",
    });
    console.log("Created:", webhook);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await close();
  }
}

test();
