/**
 * The operations the Atlas app sends, copied from atlas-migracoes
 * `src/lib/atlas.ts` (2026-10-20). The query limits must keep accepting them;
 * update this copy when the app's queries change.
 */
export const appOperations: Record<string, string> = {
  Overview: /* GraphQL */ `
  query Overview {
    meta {
      source
    }
    stats {
      artists
      works
      exhibitions
      publications
      places
      originCountries
    }
  }
`,
  ExplorarMap: /* GraphQL */ `
  
  fragment MapPlace on Place {
    id
    label
    country
    currentName
    lat
    lng
  }

  fragment MapDate on FuzzyDate {
    raw
    year
    endYear
    iso
    precision
  }


  query ExplorarMap {
    artists {
      slug
      name
      birthPlace {
        ...MapPlace
      }
      birthDate {
        ...MapDate
      }
      deathPlace {
        ...MapPlace
      }
      deathDate {
        ...MapDate
      }
      exhibitions {
        id
        title
        startDate {
          ...MapDate
        }
        place {
          ...MapPlace
        }
      }
    }
  }
`,
  ArtistRecord: /* GraphQL */ `
  
  fragment MapPlace on Place {
    id
    label
    country
    currentName
    lat
    lng
  }

  fragment MapDate on FuzzyDate {
    raw
    year
    endYear
    iso
    precision
  }


  query ArtistRecord($slug: String!) {
    meta {
      source
    }
    artist(slug: $slug) {
      slug
      name
      birthPlace {
        ...MapPlace
      }
      birthDate {
        ...MapDate
      }
      deathPlace {
        ...MapPlace
      }
      deathDate {
        ...MapDate
      }
      exhibitions {
        id
        title
        startDate {
          ...MapDate
        }
        endDate {
          ...MapDate
        }
        institution
        venue
        place {
          ...MapPlace
        }
      }
      works {
        id
        title
        date {
          ...MapDate
        }
        technique
        dimensions
        acquisition
        acquisitionDate {
          ...MapDate
        }
      }
      publications {
        id
        authors
        title
        city
        publisher
        date {
          ...MapDate
        }
        category
        periodical
      }
    }
  }
`,
  Network: /* GraphQL */ `
  
  fragment MapPlace on Place {
    id
    label
    country
    currentName
    lat
    lng
  }

  fragment MapDate on FuzzyDate {
    raw
    year
    endYear
    iso
    precision
  }


  query Network {
    meta {
      source
    }
    artists {
      slug
      name
      birthPlace {
        ...MapPlace
      }
      birthDate {
        ...MapDate
      }
      deathPlace {
        ...MapPlace
      }
      works {
        id
        title
        date {
          ...MapDate
        }
        exhibitions {
          id
          title
          startDate {
            ...MapDate
          }
          institution
          place {
            ...MapPlace
          }
        }
        publications {
          id
          title
          date {
            ...MapDate
          }
          periodical
        }
      }
    }
  }
`,
  ArtistList: /* GraphQL */ `
  query ArtistList {
    meta {
      source
    }
    artists {
      slug
      name
    }
  }
`,
  Research: /* GraphQL */ `
  
  fragment MapPlace on Place {
    id
    label
    country
    currentName
    lat
    lng
  }

  fragment MapDate on FuzzyDate {
    raw
    year
    endYear
    iso
    precision
  }


  query Research($slug: String!) {
    research(slug: $slug) {
      artist {
        slug
        name
        birthPlace {
          ...MapPlace
        }
        birthDate {
          ...MapDate
        }
        deathPlace {
          ...MapPlace
        }
        deathDate {
          ...MapDate
        }
      }
      searchedNames
      match {
        id
        label
        description
        url
        basis
      }
      candidates {
        id
        label
        description
        url
        birthYear
        foundBy
        reason
      }
      findings {
        source
        sourceUrl
        sourceTitle
        property
        propertyId
        value
        references
        reliability
        reviews
      }
      sources {
        source
        status
        detail
      }
      period {
        day
        approximate
        birthState
        states
      }
      summary {
        status
        text
        citations
        prompt
        model
        detail
      }
      retrievedAt
    }
  }
`,
};
