import Image from "next/image";

export function PersonaWordmark() {
  return (
    <div className="persona-wordmark">
      <Image
        className="persona-wordmark__logo"
        src="/persona-wordmark.png"
        alt="Persona"
        width={2172}
        height={724}
        priority
      />
    </div>
  );
}
