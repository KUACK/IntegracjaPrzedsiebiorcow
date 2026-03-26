export async function onRequestGet() {
  return new Response("pong", { status: 200 });
}
