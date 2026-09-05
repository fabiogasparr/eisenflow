// Precisa ser o PRIMEIRO import: guarda o fragmento da URL (#access_token=...,
// #error=...) antes que o cliente do Supabase o consuma e limpe a barra.
import "./lib/hashInicial";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Uma promise rejeitada sem catch não aparecia em lugar nenhum para o usuário.
window.addEventListener("unhandledrejection", (e) => {
  console.error("[EisenFlow] promise rejeitada sem tratamento:", e.reason);
});

createRoot(document.getElementById("root")!).render(<App />);
