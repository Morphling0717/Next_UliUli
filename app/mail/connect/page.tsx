import { WindChimeGatewayBinding } from "@windchime/embed/broadcast";
export default function ConnectPage() {
  return <WindChimeGatewayBinding gatewayOrigin={process.env.WINDCHIME_GATEWAY_ORIGIN} />;
}
