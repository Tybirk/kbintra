import { Title, Text, Paper, Stack, Anchor, List } from "@mantine/core"

import { Link } from "react-router-dom"

export default function PrivacyPolicyPage() {
  return (
    <Paper maw={760} mx="auto" p={{ base: "md", sm: "xl" }}>
      <Stack gap="xl">
        <div>
          <Title order={1} mb="xs">
            Privatlivspolitik
          </Title>
          <Text c="dimmed" size="sm">
            Senest opdateret: februar 2026
          </Text>
        </div>

        <Stack gap="sm">
          <Title order={3}>1. Dataansvarlig</Title>
          <Text>
            Den dataansvarlige for denne platform er bofællesskabet. Har du
            spørgsmål til behandlingen af dine personoplysninger, kan du
            kontakte administratorerne via platformens beskedfunktion eller på{" "}
            <Anchor href="mailto:kloeverbakken@kloeverbakken-odder.dk">
              kloeverbakken@kloeverbakken-odder.dk
            </Anchor>
            .
          </Text>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>2. Hvilke oplysninger indsamler vi?</Title>
          <Text>Vi behandler følgende personoplysninger om dig:</Text>
          <List spacing="xs">
            <List.Item>
              <strong>Profiloplysninger:</strong> Navn, emailadresse,
              telefonnummer, fødselsdato, profilbillede og en kort biografi
            </List.Item>
            <List.Item>
              <strong>Husoplysninger:</strong> Hvilket hus du bor i
            </List.Item>
            <List.Item>
              <strong>Kommunikation:</strong> Indlæg og tråde i forummet,
              private beskeder til andre beboere, opslag og reaktioner
            </List.Item>
            <List.Item>
              <strong>Madrelateret:</strong> Madregistreringer, madbilletter,
              madholdsmedlemskaber og madønsker
            </List.Item>
            <List.Item>
              <strong>Kalender:</strong> Deltagelse i fællesarrangementer
            </List.Item>
            <List.Item>
              <strong>Tekniske data:</strong> Tidspunkt for oprettelse og senest
              aktivitet, notifikationspræferencer og push-abonnementer
            </List.Item>
          </List>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>3. Hvorfor behandler vi dine oplysninger?</Title>
          <Text>
            Platformen bruges til at koordinere og kommunikere i bofællesskabet.
            Det retslige grundlag for behandlingen er{" "}
            <strong>legitim interesse</strong> (GDPR art. 6, stk. 1, litra f) —
            det er nødvendigt at behandle dine oplysninger for at du kan deltage
            i fællesskabets dagligdag. Konkret bruges dine oplysninger til:
          </Text>
          <List spacing="xs">
            <List.Item>At vise din profil for andre beboere</List.Item>
            <List.Item>
              At give dig adgang til fora, kalender og beskedfunktion
            </List.Item>
            <List.Item>At administrere madregistreringer og madhold</List.Item>
            <List.Item>
              At sende dig notifikationer om relevante begivenheder
            </List.Item>
          </List>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>4. Hvem kan se dine oplysninger?</Title>
          <Text>
            Dine oplysninger er kun tilgængelige for andre registrerede beboere
            i bofællesskabet. Platformen er lukket og kræver invitation for at
            få adgang. Private beskeder er kun synlige for samtalens deltagere.
            Dine oplysninger deles ikke med tredjepart ud over de
            infrastrukturudbydere, der driver platformen (hosting, e-mail).
          </Text>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>5. Hvor længe gemmer vi dine oplysninger?</Title>
          <Text>
            Vi opbevarer dine oplysninger, så længe du er aktiv bruger af
            platformen. Hvis du forlader bofællesskabet og ønsker dine data
            slettet, kan du til enhver tid anmode om sletning — se afsnit 6.
            Administratorer kan manuelt slette inaktive konti.
          </Text>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>6. Dine rettigheder</Title>
          <Text>Du har følgende rettigheder efter databeskyttelsesloven:</Text>
          <List spacing="xs">
            <List.Item>
              <strong>Indsigt:</strong> Du kan se alle dine data ved at
              downloade dem under{" "}
              <Anchor component={Link} to="/profil/rediger">
                Rediger profil → Mine data
              </Anchor>
            </List.Item>
            <List.Item>
              <strong>Berigtigelse:</strong> Du kan rette dine profiloplysninger
              direkte i appen under{" "}
              <Anchor component={Link} to="/profil/rediger">
                Rediger profil
              </Anchor>
            </List.Item>
            <List.Item>
              <strong>Sletning:</strong> Du kan slette din konto og alle
              tilknyttede personoplysninger under{" "}
              <Anchor component={Link} to="/profil/rediger">
                Rediger profil → Slet min konto
              </Anchor>
            </List.Item>
            <List.Item>
              <strong>Dataportabilitet:</strong> Du kan downloade dine data i
              maskinlæsbart format (JSON) under{" "}
              <Anchor component={Link} to="/profil/rediger">
                Rediger profil → Download mine data
              </Anchor>
            </List.Item>
            <List.Item>
              <strong>Begrænsning og indsigelse:</strong> Kontakt
              administratorerne, hvis du ønsker at begrænse behandlingen af dine
              oplysninger
            </List.Item>
          </List>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>7. Klage</Title>
          <Text>
            Hvis du mener, at vi behandler dine personoplysninger i strid med
            databeskyttelsesreglerne, har du ret til at indgive en klage til
            Datatilsynet:{" "}
            <Anchor
              href="https://www.datatilsynet.dk"
              target="_blank"
              rel="noreferrer"
            >
              datatilsynet.dk
            </Anchor>
          </Text>
        </Stack>
      </Stack>
    </Paper>
  )
}
