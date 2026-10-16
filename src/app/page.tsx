import { FrontDoor } from "@/components/front/FrontDoor";
import { WithFiles } from "@/lib/data/WithFiles";

// The front page's numbers and ticker read every deployment's file.
export default function Home() {
  return (
    <WithFiles all>
      <FrontDoor />
    </WithFiles>
  );
}
